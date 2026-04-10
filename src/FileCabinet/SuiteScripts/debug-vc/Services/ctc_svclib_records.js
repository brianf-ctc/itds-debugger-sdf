/**
 * Copyright (c) 2026 Catalyst Tech Corp
 * All Rights Reserved.
 *
 * This software is the confidential and proprietary information of
 * Catalyst Tech Corp. ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with Catalyst Tech.
 *
 * Script Name: VC Services | Records Library
 * @author brianf@nscatalyst.com
 * @description Shared record and search helper library for the VAR Connect service layer.
 *              Centralizes record loading, transformation, search, and line extraction helpers with
 *              consistent error handling, cache-aware searches, and reusable transaction field groups.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-31   brianf        Skip cache lookup in searchRecord when returnSearchObj is true
 * 2026-03-27   brianf        Added poId/poNum/name aliases to searchTransaction; added getLineCount method
 * 2026-03-25   brianf        Switched searchRecord to paged search execution to avoid the 4000-row limit; simplified updateRecord success log parameters
 * 2026-03-17   brianf        Merged v1 and v2: integrated v2 modular structure (TXNFIELDS semantic grouping, Helper utility) with v1 standards (Endpoint
 *                            naming, enhanced documentation); fixed extractLineValues to preserve explicit line 0 handling after validating lib_utils.isEmpty
 *                            semantics; fixed saved-search execution, cache key column isolation, generic transaction recordNum filtering, TXNFIELDS mutation,
 *                            and updateLineValues logTitle formatting
 * 2026-03-03   brianf        Fixed load() null dereference; fixed cacheKeyFilter.data access; fixed results.hasError checks in all wrapper functions; fixed
 *                            bare util.isArray/isObject and ns_util.inArray; fixed searchTransactions logTitle typo; fixed catch-block semicolons/indentation
 * 2026-02-06   brianf        Added cache key helper, searchId override warning, and completed full optimization/standards review
 * 2026-02-03   brianf        Refactored to VAR Connect 2.x standards: replaced vc2_util with lib_utils, added Endpoint wrapper, fixed return patterns
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'SVC:Records';

    var vclib_util = require('./lib/ctc_lib_utils.js'),
        vclib_error = require('./lib/ctc_lib_error.js');

    var ns_search = require('N/search'),
        ns_record = require('N/record'),
        ns_util = require('N/util');

    var CACHE_TTL = 300; // store the data

    var ERROR_LIST = {
        RECORD_NOT_FOUND: {
            code: 'RECORD_NOT_FOUND',
            message: 'Record not found',
            level: vclib_error.ErrorLevel.WARNING
        },
        RECORD_SEARCH_EMPTY: {
            code: 'RECORD_SEARCH_EMPTY',
            message: 'Unable to find the record',
            level: vclib_error.ErrorLevel.WARNING
        },

        INVALID_RCRD_TYPE: {
            code: 'INVALID_RCRD_TYPE',
            message: 'Invalid or missing record type',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        MISSING_RECORD_PARAMETER: {
            code: 'MISSING_RECORD_PARAMETER',
            message: 'Need to provide either the record Id or record Num',
            level: vclib_error.ErrorLevel.CRITICAL
        }
    };

    var TXNFIELDS = {
        HEADER: [
            'internalid',
            'type',
            'tranid',
            'trandate',
            'entity',
            'postingperiod',
            'amount',
            'createdfrom',
            'custbody_isdropshippo',
            'custbody_ctc_po_link_type',
            'custbody_ctc_vc_override_ponum',
            'custbody_ctc_bypass_vc'
        ],
        SEARCHCOLS: ['lineuniquekey', 'line', 'item', 'rate', 'amount', 'quantity', 'location'],
        LINE: [
            'lineuniquekey',
            'poline',
            'orderline',
            'createpo',
            'createdpo',
            'orderdoc',
            'line',
            'linenumber',
            'itemname',
            'item',
            'rate',
            'amount',
            'quantity',
            'location',
            'quantityreceived',
            'quantitybilled',
            'quantityfulfilled',
            'fulfillable',
            'taxrate',
            'taxrate1',
            'taxrate2'
        ]
    };

    var Helper = {
        /**
         * Generates a stable cache key from a filters/columns object or array.
         * @function buildCacheKey
         * @param {Object|Array} option - Filters or columns to normalize for cache key.
         * @returns {string|false} Normalized JSON string for use as a cache key, or false on error.
         */
        buildCacheKey: function (option) {
            var logTitle = [LogTitle, 'Helper:buildCacheKey'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var normalizeValue = function (value) {
                    if (ns_util.isArray(value)) {
                        var arr = [];
                        for (var i = 0; i < value.length; i++) {
                            arr.push(normalizeValue(value[i]));
                        }
                        return arr;
                    }

                    if (ns_util.isObject(value)) {
                        var keys = Object.keys(value).sort();
                        var obj = {};
                        for (var j = 0; j < keys.length; j++) {
                            var key = keys[j];
                            obj[key] = normalizeValue(value[key]);
                        }
                        return obj;
                    }

                    return value;
                };

                var paramValues = JSON.stringify(normalizeValue(option));

                // override
                returnValue = paramValues;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        }
    };

    var Endpoint = {
        /**
         * Executes a generic record search with optional saved-search support and cached results.
         *
         * Resolution order:
         * 1. `searchId` loads and runs the saved search definition.
         * 2. `filters` are used as provided when no saved search is supplied.
         * 3. `id` / `internalid` resolve to an internal ID filter.
         * 4. Transaction `recordNum` / `tranid` resolve to `numbertext`.
         * 5. `recordName` / `name` resolve to a name filter.
         *
         * The cache key includes the resolved type, filters, columns, and saved search ID so
         * different result shapes do not overwrite each other.
         *
         * @function searchRecord
         * @param {Object} option - Search configuration.
         * @param {string} [option.type] - Record type such as `transaction` or a custom record type.
         * @param {string} [option.recordType] - Alias for `type`.
         * @param {string} [option.searchId] - Saved search ID to load and execute directly.
         * @param {Array|Object} [option.filters] - Search filters used when `searchId` is not provided.
         * @param {Array|Object} [option.columns] - Search columns used when `searchId` is not provided.
         * @param {Array|Object} [option.fields] - Alias for `columns`.
         * @param {string|number} [option.id] - Internal ID shortcut.
         * @param {string|number} [option.internalid] - Alias for `id`.
         * @param {string} [option.recordName] - Name shortcut for non-transaction searches.
         * @param {string} [option.name] - Alias for `recordName`.
         * @param {string|number} [option.recordNum] - Transaction number shortcut.
         * @param {string|number} [option.tranid] - Alias for `recordNum`.
         * @param {boolean} [option.returnSingleRecord] - Stops after the first match when true.
         * @param {boolean} [option.returnSearchObj] - Returns the search object instead of results.
         * @returns {Object|Array|false} Search result data, the search object, or `false` on error.
         */
        searchRecord: function (option) {
            var logTitle = [LogTitle, 'searchRecord'].join('::'),
                returnValue = null;

            option = option || {};
            try {
                var recordId = option.id || option.internalid,
                    recordName = option.recordName || option.name,
                    recordNum = option.recordNum || option.tranid,
                    recordType = option.type || option.recordType,
                    searchFields = option.fields || option.columns,
                    searchFilters = option.filters,
                    searchObj = null;

                var searchOption = {
                    type: recordType,
                    filters: searchFilters
                        ? searchFilters
                        : recordId
                          ? [['internalid', 'anyof', recordId]]
                          : recordType == 'transaction' && recordNum
                            ? [['numbertext', 'is', recordNum]]
                            : recordName
                              ? [['name', 'is', recordName]]
                              : [],
                    columns: searchFields || []
                };

                if (option.searchId) {
                    // Use the loaded saved search directly so its native type and definition stay intact.
                    searchObj = ns_search.load({ id: option.searchId });

                    // Saved searches own their filters and columns, so mixed inputs are only informational.
                    if (
                        (option.filters && option.filters.length) ||
                        (option.columns && option.columns.length)
                    ) {
                        vclib_util.logWarn(
                            logTitle,
                            'option.searchId overrides option.filters/columns'
                        );
                    }

                    // Mirror the loaded definition for cache-key generation and result extraction.
                    searchOption.filters = searchObj.filters;
                    searchOption.columns = searchObj.columns;
                    searchOption.type = searchOption.type || searchObj.searchType;
                }

                // Include filters, columns, and saved search identity so cached result shapes stay isolated.
                var cacheKeyParts = [searchOption.type || option.searchId || 'search'];
                var cacheKeyFilter = Helper.buildCacheKey(searchOption.filters);
                if (cacheKeyFilter) cacheKeyParts.push(cacheKeyFilter);
                var cacheKeyCols = Helper.buildCacheKey(searchOption.columns);
                if (cacheKeyCols) cacheKeyParts.push(cacheKeyCols);
                if (option.searchId) cacheKeyParts.push(option.searchId);

                var cacheKey = cacheKeyParts.join('__') + new Date().getTime();

                // Return cached results before running the search again.
                // Skip cache when the caller wants the live search object.
                var cachedData = !option.returnSearchObj
                    ? vclib_util.getNSCache({ name: cacheKey, isJSON: true })
                    : null;
                if (!vclib_util.isEmpty(cachedData)) {
                    returnValue = cachedData;
                    return returnValue;
                }

                var doReturnOne =
                    option.returnSingleRecord !== false &&
                    (option.returnSingleRecord || recordId || recordNum || recordName);

                // Reuse the loaded saved search when present, otherwise build a fresh search object.
                searchObj = searchObj || ns_search.create(searchOption);
                if (!searchObj.runPaged().count) throw 'RECORD_SEARCH_EMPTY';

                // Allow callers to inspect or reuse the search object without executing result mapping.
                if (option.returnSearchObj) {
                    returnValue = searchObj;
                    return returnValue;
                }

                var resultsList = [];
                var pageSize = 1000;

                // Process search results in batches of 1000 to prevent hitting 4000-row limit
                var pagedResults = searchObj.runPaged({ pageSize: pageSize });

                for (var pageIdx = 0; pageIdx < pagedResults.pageRanges.length; pageIdx++) {
                    var pageData = pagedResults.fetch({ index: pageIdx });

                    for (var rowIdx = 0; rowIdx < pageData.data.length; rowIdx++) {
                        var row = pageData.data[rowIdx];
                        var recordData = { id: row.id };

                        for (var i = 0; i < searchOption.columns.length; i++) {
                            var col = searchOption.columns[i],
                                colName = col.name || col,
                                colValue = row.getValue(col),
                                colText = row.getText(col);

                            recordData[colName] = colValue;

                            if (colText && colText !== colValue) {
                                recordData[colName + '_text'] = colText;
                            }
                        }
                        recordData.searchRow = row;

                        resultsList.push(recordData);

                        if (doReturnOne) {
                            pageIdx = pagedResults.pageRanges.length;
                            break;
                        }
                    }

                    if (doReturnOne) break;
                }

                if (doReturnOne || resultsList.length === 1) {
                    returnValue = resultsList[0];

                    vclib_util.setNSCache({
                        name: cacheKey,
                        value: resultsList[0],
                        cacheTTL: CACHE_TTL
                    });

                    return returnValue;
                } else {
                    returnValue = resultsList;

                    vclib_util.setNSCache({
                        name: cacheKey,
                        value: resultsList,
                        cacheTTL: CACHE_TTL
                    });
                }
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * Searches for transactions with default filters/columns, supports PO/other types.
         * @function searchTransactions
         * @param {Object} option - Search configuration
         * @returns {Array|false} Array of matching transaction records, or false on error.
         */
        searchTransactions: function (option) {
            var logTitle = [LogTitle, 'searchTransactions'].join('::'),
                returnValue = null;

            option = option || {};
            try {
                var recordType = option.type || option.recordType || 'transaction',
                    recordNum = option.tranid || option.recordNum,
                    recordId = option.id || option.internalid || option.recordId;

                var results = Endpoint.searchRecord(
                    ns_util.extend(
                        option,
                        // extend the search option with default transaction search criteria
                        {
                            recordType: recordType,
                            filters: (function () {
                                var filters = [['mainline', 'is', 'T']];

                                if (recordId) {
                                    filters.push('AND', ['internalid', 'anyof', recordId]);
                                } else if (recordNum) {
                                    filters.push(
                                        'AND',
                                        recordType == ns_record.Type.PURCHASE_ORDER
                                            ? [
                                                  ['numbertext', 'is', recordNum],
                                                  'OR',
                                                  [
                                                      'custbody_ctc_vc_override_ponum',
                                                      'is',
                                                      recordNum
                                                  ]
                                              ]
                                            : ['numbertext', 'is', recordNum]
                                    );
                                } else {
                                    if (ns_util.isArray(option.filters) && option.filters.length) {
                                        filters.push('AND', option.filters);
                                    }
                                }

                                return filters;
                            })(),
                            columns: (function () {
                                // Clone the shared field list so per-call additions do not mutate TXNFIELDS.
                                var cols = TXNFIELDS.HEADER.slice(0);
                                if (ns_util.isArray(option.columns) && option.columns.length) {
                                    cols = cols.concat(option.columns);
                                } else if (
                                    ns_util.isObject(option.columns) &&
                                    !vclib_util.isEmpty(option.columns)
                                ) {
                                    for (var col in option.columns)
                                        if (col && !vclib_util.inArray(col, cols)) cols.push(col);
                                }

                                if (vclib_util.isOneWorld()) {
                                    cols.push('subsidiary');
                                    cols.push('subsidiary.country');
                                }
                                return vclib_util.uniqueArray(cols);
                            })()
                        }
                    )
                );
                if (!results) throw 'RECORD_SEARCH_EMPTY';
                returnValue = results;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Searches for transaction lines (mainline = F) with default line columns.
         * @function searchTransactionLines
         * @param {Object} option - Search configuration
         * @param {string} [option.type] - Record type (defaults to transaction)
         * @param {string|number} [option.id] - Record internalid
         * @param {string|number} [option.internalid] - Alias for id
         * @param {string|number} [option.recordNum] - Transaction number
         * @param {string|number} [option.tranid] - Alias for recordNum
         * @param {Array|Object} [option.filters] - Additional filters
         * @param {Array|Object} [option.columns] - Additional columns
         * @param {boolean} [option.returnSearchObj] - Return the search object instead of results
         * @returns {Array|false} Array of matching transaction line records, or false on error.
         */
        searchTransactionLines: function (option) {
            var logTitle = [LogTitle, 'searchTransactionLines'].join('::'),
                returnValue = null;

            option = option || {};
            try {
                var recordType = option.type || option.recordType || 'transaction',
                    recordId = option.id || option.internalid || option.recordId,
                    recordNum = option.recordNum || option.tranid || option.poNum;

                var results = Endpoint.searchRecord(
                    ns_util.extend(
                        option,
                        // extend the search option with default transaction search criteria
                        {
                            recordType: recordType,
                            returnSingleRecord: false,
                            filters: (function () {
                                var filters = [['mainline', 'is', 'F']];

                                if (recordId) {
                                    filters.push('AND', ['internalid', 'anyof', recordId]);
                                } else if (recordNum) {
                                    filters.push(
                                        'AND',
                                        recordType == ns_record.Type.PURCHASE_ORDER
                                            ? [
                                                  ['numbertext', 'is', recordNum],
                                                  'OR',
                                                  [
                                                      'custbody_ctc_vc_override_ponum',
                                                      'is',
                                                      recordNum
                                                  ]
                                              ]
                                            : ['numbertext', 'is', recordNum]
                                    );
                                } else if (!vclib_util.isEmpty(option.filters)) {
                                    filters.push('AND', option.filters);
                                }

                                return filters;
                            })(),
                            columns: (function () {
                                // Clone the shared field list so per-call additions do not mutate TXNFIELDS.
                                var columns = TXNFIELDS.SEARCHCOLS.slice(0);
                                if (ns_util.isArray(option.columns) && option.columns.length) {
                                    columns = columns.concat(option.columns);
                                } else if (
                                    ns_util.isObject(option.columns) &&
                                    !vclib_util.isEmpty(option.columns)
                                ) {
                                    for (var col in option.columns) {
                                        if (col && !vclib_util.inArray(col, columns))
                                            columns.push(col);
                                    }
                                }

                                return vclib_util.uniqueArray(columns);
                            })()
                        }
                    )
                );
                if (!results) throw 'RECORD_SEARCH_EMPTY';
                returnValue = results;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Searches for a single transaction record (by id or number).
         * @function searchTransaction
         * @param {Object} option - Search configuration
         * @returns {Object|false} First matching transaction record, or false on error.
         */
        searchTransaction: function (option) {
            var logTitle = [LogTitle, 'searchTransaction'].join('::'),
                returnValue = null;
            option = option || {};
            try {
                var recordId = option.id || option.internalid || option.recordId || option.poId,
                    recordNum = option.tranid || option.recordNum || option.poNum || option.name;

                if (!recordId && !recordNum) throw 'MISSING_RECORD_PARAMETER';

                var results = Endpoint.searchTransactions(
                    ns_util.extend(option, {
                        recordType: option.type || option.recordType || 'transaction',
                        recordId: option.id || option.internalid || option.recordId || option.poId,
                        recordNum: option.tranid || option.recordNum || option.poNum || option.name,
                        returnSingleRecord: true
                    })
                );
                if (!results) throw 'RECORD_SEARCH_EMPTY';
                returnValue = results;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * Searches for a purchase order by id or number.
         * @function searchPurchaseOrders
         * @param {Object} option - Search configuration
         * @returns {Array|false} Array of matching purchase order records, or false on error.
         */
        searchPurchaseOrders: function (option) {
            var logTitle = [LogTitle, 'searchPurchaseOrders'].join('::'),
                returnValue = null;
            option = option || {};
            try {
                var results = Endpoint.searchTransactions(
                    ns_util.extend(option, {
                        recordType: ns_record.Type.PURCHASE_ORDER,
                        recordId: option.poId || option.id || option.internalid || option.recordId,
                        recordNum: option.poNum || option.tranid || option.recordNum
                    })
                );
                if (!results) throw 'RECORD_SEARCH_EMPTY';

                returnValue = results;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * Updates a record or submits fields, given a record object or type/id.
         * @function updateRecord
         * @param {Object} option - Update configuration
         * @param {Object} [option.record] - Loaded record object
         * @param {string} [option.type] - Record type
         * @param {string|number} [option.id] - Record ID
         * @param {Object} option.data - Field values to update
         * @returns {number|false} Saved record ID on success, or false on error.
         */
        updateRecord: function (option) {
            var logTitle = [LogTitle, 'updateRecord'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };

                var recordObj = option.record,
                    recordType = option.type,
                    recordId = option.id,
                    recordData = option.data;

                if (!recordData) throw { code: 'MISSING_PARAMETER', detail: 'data' };

                // require either a record object OR both recordType and recordId
                if (!recordObj && (!recordType || !recordId)) {
                    throw { code: 'MISSING_PARAMETER', detail: 'record or type/id' };
                }

                if (recordObj) {
                    for (var key in recordData) {
                        if (recordData.hasOwnProperty(key)) {
                            recordObj.setValue({
                                fieldId: key,
                                value: recordData[key]
                            });
                        }
                    }

                    returnValue = recordObj.save();
                } else {
                    returnValue = ns_record.submitFields({
                        type: recordType,
                        id: recordId,
                        values: recordData,
                        options: {
                            enableSourcing: false,
                            ignoreMandatoryFields: true
                        }
                    });
                }

                vclib_util.log(logTitle, 'Record updated successfully', {
                    type: recordType,
                    id: recordId
                });
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Updates values on a specific line of a sublist.
         * @function updateLineValues
         * @param {Object} option - Update configuration
         * @param {Object} option.record - Loaded record object
         * @param {number} option.line - Line number
         * @param {string} [option.sublistId='item'] - Sublist ID
         * @param {Object} option.data - Field values to update
         * @param {boolean} [option.noCommit=false] - Skip commitLine if true
         * @returns {boolean|false} true on success, false on error.
         */
        updateLineValues: function (option) {
            var logTitle = [LogTitle, 'updateLineValues'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };

                var recordObj = option.record,
                    line = option.line,
                    sublistId = option.sublistId || 'item',
                    lineValues = option.data || option.lineValues || option.values,
                    noCommit = option.noCommit || false;

                if (vclib_util.isEmpty(recordObj)) throw 'Missing required parameter: record';
                if (vclib_util.isEmpty(lineValues)) throw 'Missing required parameter: lineValues';
                if (vclib_util.isEmpty(line)) throw 'Missing required parameter: line';

                var isDynamic = recordObj.isDynamic || false;

                if (isDynamic) recordObj.selectLine({ sublistId: sublistId, line: line });

                // vclib_util.log(logTitle, '.... updateLineValues', lineValues);

                for (var fld in lineValues) {
                    var colValue = lineValues[fld];
                    if (vclib_util.isEmpty(colValue)) continue;

                    if (isDynamic) {
                        recordObj.setCurrentSublistValue({
                            sublistId: sublistId || 'item',
                            fieldId: fld,
                            line: line,
                            value: colValue
                        });
                    } else {
                        recordObj.setSublistValue({
                            sublistId: sublistId || 'item',
                            fieldId: fld,
                            line: line,
                            value: colValue
                        });
                    }
                }

                if (isDynamic && !noCommit) recordObj.commitLine({ sublistId: sublistId });

                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Adds a new line to a sublist and sets values.
         * @function addNewLine
         * @param {Object} option - Add line configuration
         * @param {Object} option.record - Loaded record object
         * @param {string} [option.sublistId='item'] - Sublist ID
         * @param {Object} option.data - Field values to set
         * @param {boolean} [option.noCommit=false] - Skip commitLine if true
         * @returns {number|false} New line number on success, or false on error.
         */
        addNewLine: function (option) {
            var logTitle = [LogTitle, 'addNewLine'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };

                var recordObj = option.record,
                    sublistId = option.sublistId || 'item',
                    lineValues = option.data || option.lineValues || option.values,
                    noCommit = option.noCommit || false;

                if (vclib_util.isEmpty(recordObj)) throw 'Missing required parameter: record';
                if (vclib_util.isEmpty(lineValues)) throw 'Missing required parameter: lineValues';

                var isDynamic = recordObj.isDynamic || false,
                    line = recordObj.getLineCount({ sublistId: sublistId });

                if (isDynamic) recordObj.selectNewLine({ sublistId: sublistId });

                vclib_util.log(logTitle, '.... addNewLine', lineValues);

                for (var fld in lineValues) {
                    var colValue = lineValues[fld];
                    if (vclib_util.isEmpty(colValue)) continue;

                    if (isDynamic) {
                        recordObj.setCurrentSublistValue({
                            sublistId: sublistId,
                            fieldId: fld,
                            value: colValue
                        });
                    } else {
                        recordObj.setSublistValue({
                            sublistId: sublistId,
                            fieldId: fld,
                            line: line,
                            value: colValue
                        });
                    }
                }

                if (isDynamic && !noCommit) recordObj.commitLine({ sublistId: sublistId });

                returnValue = line;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Sets multiple field values on a record.
         * @function setValues
         * @param {Object} option - Set values configuration
         * @param {Object} option.record - Loaded record object
         * @param {Object} option.data - Field values to set
         * @returns {boolean|false} true on success, false on error.
         */
        setValues: function (option) {
            var logTitle = [LogTitle, 'setValues'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };
                var recordObj = option.record,
                    recordData = option.data || option.values;

                if (!recordObj) throw { code: 'MISSING_PARAMETER', detail: 'record' };
                if (!recordData) throw { code: 'MISSING_PARAMETER', detail: 'data' };

                for (var key in recordData) {
                    if (recordData.hasOwnProperty(key)) {
                        recordObj.setValue({
                            fieldId: key,
                            value: recordData[key]
                        });
                    }
                }
                vclib_util.log(logTitle, 'Values set successfully', { data: recordData });

                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Extracts field values (and text) from a record for given columns.
         * @function extractValues
         * @param {Object} option - Extract configuration
         * @param {Object} option.record - Loaded record object
         * @param {Array|string[]} option.columns - Fields to extract
         * @returns {Object|false} Object of extracted field values keyed by column name, or false on error.
         */
        extractValues: function (option) {
            var logTitle = [LogTitle, 'extractValues'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };

                var recordObj = option.record,
                    columns = option.columns || option.fields,
                    recordData = {};

                if (!recordObj) throw { code: 'MISSING_PARAMETER', detail: 'record' };
                if (!columns) throw { code: 'MISSING_PARAMETER', detail: 'columns' };

                if (ns_util.isArray(columns)) {
                    for (var i = 0, j = columns.length; i < j; i++) {
                        var colName = columns[i],
                            colValue = recordObj.getValue({ fieldId: colName }),
                            colText = recordObj.getText({ fieldId: colName });

                        recordData[colName] = colValue;

                        if (colText && colText != colValue) recordData[colName + '_text'] = colText;
                    }
                } else if (ns_util.isObject(columns)) {
                    for (var fld in columns) {
                        var colName = columns[fld],
                            colValue = recordObj.getValue({ fieldId: colName }),
                            colText = recordObj.getText({ fieldId: colName });

                        recordData[fld] = colValue;
                        if (colText && colText != colValue) recordData[fld + '_text'] = colText;
                    }
                }

                returnValue = recordData;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Extracts values from all lines of a sublist, optionally filtered.
         * @function extractLineValues
         * @param {Object} option - Extract configuration
         * @param {Object} [option.record] - Loaded record object (or loaded by poId)
         * @param {string} [option.sublistId='item'] - Sublist ID
         * @param {Array} [option.columns] - Fields to extract
         * @param {Array} [option.additionalColumns] - Extra fields to extract
         * @param {Object} [option.filter] - Filter object for line matching
         * @param {number} [option.lineNo|option.line] - Specific line to extract
         * @returns {Array|Object|false} Array of line data objects, or a single object if lineNo is specified, or false on error.
         */
        extractLineValues: function (option) {
            var logTitle = [LogTitle, 'extractLineValues'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };
                if (!option.record) {
                    if (!option.poId) throw { code: 'MISSING_PARAMETER', detail: 'poId or record' };

                    // if (!option.type) throw 'Missing required parameter: type';

                    option.record = ns_record.load({
                        type: option.type || ns_record.Type.PURCHASE_ORDER,
                        id: option.poId
                    });
                }
                var recordObj = option.record,
                    columns = option.columns || [],
                    additionalColumns = option.additionalColumns || [],
                    recordLines = [],
                    filter = option.filter || {};

                columns = columns.concat(TXNFIELDS.LINE);

                // Append optional fields after the default line field set has been established.
                if (!vclib_util.isEmpty(additionalColumns))
                    columns = columns.concat(additionalColumns);

                columns = vclib_util.uniqueArray(columns);

                // Respect an explicit line 0 instead of treating it like an omitted selector.
                var hasLineNo = option.hasOwnProperty('lineNo'),
                    hasLine = option.hasOwnProperty('line');

                var lineCount = recordObj.getLineCount({ sublistId: option.sublistId || 'item' }),
                    lineNo = hasLineNo ? option.lineNo : hasLine ? option.line : null;

                for (var line = 0; line < lineCount; line++) {
                    var lineData = {
                        line: line
                    };

                    if (!vclib_util.isEmpty(lineNo) && lineNo != line) continue;

                    for (var i = 0, j = columns.length; i < j; i++) {
                        var colName = columns[i],
                            colValue = recordObj.getSublistValue({
                                sublistId: option.sublistId || 'item',
                                fieldId: colName,
                                line: line
                            }),
                            colText = recordObj.getSublistText({
                                sublistId: option.sublistId || 'item',
                                fieldId: colName,
                                line: line
                            });

                        lineData[colName] = colValue;

                        if (colText && colText != colValue) lineData[colName + '_text'] = colText;
                    }

                    var match = true;
                    for (var key in filter) {
                        if (filter.hasOwnProperty(key) && lineData[key] !== filter[key]) {
                            match = false;
                            break;
                        }
                    }

                    if (match) {
                        recordLines.push(lineData);
                    }
                }

                returnValue = vclib_util.isEmpty(lineNo) ? recordLines : recordLines.shift();
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Returns the item line count for a transaction using a lightweight search.
         * Excludes mainline, tax lines, and COGS lines.
         * @function getLineCount
         * @param {Object} option - Configuration object
         * @param {string|number} option.id - Transaction internal ID
         * @param {string} [option.type='purchaseorder'] - Transaction type
         * @returns {number} Line count (0 on error)
         */
        getLineCount: function (option) {
            var logTitle = [LogTitle, 'getLineCount'].join('::');
            option = option || {};
            var returnValue = 0;

            try {
                var recordId = option.id || option.poId || option.recordId;
                if (!recordId) throw { code: 'MISSING_PARAMETER', detail: 'id' };

                ns_search
                    .create({
                        type: option.type || 'purchaseorder',
                        filters: [
                            ['internalid', 'is', recordId],
                            'AND',
                            ['mainline', 'is', 'F'],
                            'AND',
                            ['taxline', 'is', 'F'],
                            'AND',
                            ['cogs', 'is', 'F']
                        ],
                        columns: [
                            ns_search.createColumn({
                                name: 'lineuniquekey',
                                summary: ns_search.Summary.COUNT
                            })
                        ]
                    })
                    .run()
                    .each(function (result) {
                        returnValue =
                            parseInt(
                                result.getValue({
                                    name: 'lineuniquekey',
                                    summary: ns_search.Summary.COUNT
                                }),
                                10
                            ) || 0;
                        return false;
                    });
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = 0;
            }

            return returnValue;
        },

        /**
         * Loads a record by type and id.
         * @function load
         * @param {Object} option - Load configuration
         * @param {string} option.type - Record type
         * @param {string|number} option.id - Record ID
         * @param {boolean} [option.isDynamic=false] - Load as dynamic record
         * @returns {Record|false} Loaded NetSuite record, or false on error.
         */
        load: function (option) {
            var logTitle = [LogTitle, 'load'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };
                if (!option.type) throw { code: 'MISSING_PARAMETER', detail: 'type' };
                if (!option.id) throw { code: 'MISSING_PARAMETER', detail: 'id' };

                var recordType = option.type,
                    recordId = option.id,
                    isDynamic = option.isDynamic || false;

                returnValue = ns_record.load({
                    type: recordType,
                    id: recordId,
                    isDynamic: isDynamic
                });
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Transforms a record from one type to another (e.g., SO to IF).
         * @function transform
         * @param {Object} option - Transform configuration
         * @param {string} option.fromType - Source record type
         * @param {string|number} option.fromId - Source record ID
         * @param {string} option.toType - Target record type
         * @returns {Record|false} Transformed NetSuite record, or false on error.
         */
        transform: function (option) {
            var logTitle = [LogTitle, 'transform'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', detail: 'option' };
                if (!option.fromType) throw { code: 'MISSING_PARAMETER', detail: 'fromType' };
                if (!option.fromId) throw { code: 'MISSING_PARAMETER', detail: 'fromId' };
                if (!option.toType) throw { code: 'MISSING_PARAMETER', detail: 'toType' };

                returnValue = ns_record.transform(option);

                vclib_util.log(logTitle, 'Record transformed successfully', {
                    fromType: option.fromType,
                    toType: option.toType,
                    id: option.fromId || option.id
                });
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        }
    };

    return Endpoint;
});
