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
 * Script Name: CTC VC | Create Bill Files Library
 *
 * @author brianf@nscatalyst.com
 * @description Library for generating vendor bill file records and searches used by the Bill Creator workflow.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-04-20   brianf                CST-5022: Added explicit format array and strict mode to 4 unsafe moment() calls to prevent date corruption on ISO date strings
 * 2026-03-17   brianf                Converted AMD module loading and fixed process() catch error-map logging reference
 * 2026-03-02   brianf                Added comprehensive inline comments throughout all Helper functions, process(), and addNote()
 * 2026-02-27   brianf                Updated script header for standards compliance
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var ns_search = require('N/search'),
        ns_record = require('N/record'),
        ns_format = require('N/format'),
        ns_config = require('N/config'),
        ns_https = require('N/https');

    var vc2_constant = require('./../../CTC_VC2_Constants'),
        vc2_util = require('./../../CTC_VC2_Lib_Utils'),
        vcs_configLib = require('./../../Services/ctc_svclib_configlib'),
        vcs_itemMatchLib = require('./../../Services/ctc_svclib_itemmatch'),
        vcs_recordLib = require('./../../Services/ctc_svclib_records'),
        moment = require('./../../Services/lib/moment');

    var vclib_error = require('./../../Services/lib/ctc_lib_error');

    var LogTitle = 'LIB::BillFiles',
        LogPrefix;

    // Shorthand aliases for frequently used constant groups
    var ERROR_MSG = vc2_constant.ERRORMSG, // Standardized error message definitions
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS, // VC activity log status values
        CACHE = {}; // In-memory request-scoped cache for redundant search avoidance

    // Module-level config objects populated lazily during process() execution
    var MainConfig = null, // Loaded once per script run from the Main Config record
        VendorCFG, // Order vendor config for the PO currently being processed
        BillCFG; // Bill vendor config for the PO currently being processed

    var Helper = {
        // Checks whether stValue exists in arrValue; iterates in reverse for early-exit on recently added items
        inArray: function (stValue, arrValue) {
            if (!stValue || !arrValue) return false;
            for (var i = arrValue.length - 1; i >= 0; i--) if (stValue == arrValue[i]) break;
            return i > -1; // i == -1 means the loop exhausted without finding a match
        },
        uniqueArray: function (arrVar) {
            var arrNew = [];
            for (var i = 0, j = arrVar.length; i < j; i++) {
                if (Helper.inArray(arrVar[i], arrNew)) continue;
                arrNew.push(arrVar[i]);
            }

            return arrNew;
        },
        // Checks for all falsy, string-null, and structurally empty (array[]/object{}) values.
        // Uses util.isArray/util.isObject per SuiteScript type-check convention — never typeof.
        isEmpty: function (stValue) {
            return (
                stValue === '' ||
                stValue == null ||
                stValue == undefined ||
                stValue == 'undefined' || // guard against JSON.stringify(null) producing 'undefined'
                stValue == 'null' || // guard against JSON.stringify(null) producing 'null'
                (util.isArray(stValue) && stValue.length == 0) || // empty array []
                (util.isObject(stValue) &&
                    (function (v) {
                        for (var k in v) return false; // object has at least one key → not empty
                        return true; // no own keys → empty object {}
                    })(stValue))
            );
        },
        parseDate: function (option) {
            var logTitle = [LogTitle, 'parseDate'].join('::'),
                returnValue;

            var dateString = option.dateString || option,
                dateValue = '';

            try {
                // Parse the raw date string with moment; skip placeholder 'NA' and empty values
                if (dateString && dateString.length > 0 && dateString != 'NA') {
                    dateValue = moment(dateString, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(); // [ CodeMaster ] CST-5022: added explicit format array + strict mode to prevent date misparse
                }

                // Convert JS Date to a NetSuite-formatted date string (respects account date format preference)
                if (dateValue) {
                    dateValue = ns_format.format({
                        value: dateValue,
                        type: ns_format.Type.DATE
                    });
                }

                returnValue = dateValue;
            } catch (error) {
                vc2_util.logWarn(logTitle, error);
                throw error; // re-throw so callers can handle date parse failures
            }
            return returnValue;
        },
        searchVendorsByConfig: function (configId) {
            var logTitle = [LogTitle, 'searchVendorsByConfig'].join('::'),
                returnValue;

            // Use in-memory CACHE to avoid redundant NS searches for the same configId within one script run
            var cacheStr = 'vendorConfig:' + configId;
            if (!CACHE[cacheStr]) {
                var searchObj = ns_search.create({
                    type: 'vendor',
                    filters: [['custentity_vc_bill_config', 'anyof', configId]],
                    columns: ['internalid', 'entityid', 'custentity_vc_bill_config']
                });

                var arrVendors = [];
                searchObj.run().each(function (result) {
                    arrVendors.push(result.getValue({ name: 'internalid' }));
                    return true;
                });
                returnValue = arrVendors;
                CACHE[cacheStr] = returnValue;
            } else {
                returnValue = CACHE[cacheStr];
            }

            return returnValue;
        },
        searchPO: function (poName) {
            var logTitle = [LogTitle, 'searchPO'].join('::'),
                poColumns = [
                    'trandate',
                    'postingperiod',
                    'type',
                    MainConfig.overridePONum ? 'custbody_ctc_vc_override_ponum' : 'tranid',
                    'tranid',
                    'entity',
                    'amount',
                    'internalid'
                ],
                returnValue;

            vc2_util.log(logTitle, '// search for existing PO: ', poName);

            if (vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES) {
                poColumns.push('subsidiary');
            }
            var searchObj = ns_search.create({
                type: 'purchaseorder',
                filters: [
                    MainConfig.overridePONum
                        ? [
                              ['numbertext', 'is', poName],
                              'OR',
                              ['custbody_ctc_vc_override_ponum', 'is', poName]
                          ]
                        : ['numbertext', 'is', poName],
                    'AND',
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['type', 'anyof', 'PurchOrd']
                ],
                columns: poColumns
            });

            var poData = false;
            if (searchObj.runPaged().count) {
                var searchResult = searchObj.run().getRange({ start: 0, end: 1 }).shift();

                poData = {
                    id: searchResult.getValue({ name: 'internalid' }),
                    entityId: searchResult.getValue({ name: 'entity' }),
                    entityName: searchResult.getText({ name: 'entity' }),
                    tranId: searchResult.getValue({ name: 'tranid' }),
                    date: searchResult.getValue({ name: 'trandate' }),
                    subsidiary: null
                };
                if (vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES) {
                    poData.subsidiary = searchResult.getValue({ name: 'subsidiary' });
                }
            }
            returnValue = poData;
            vc2_util.log(logTitle, '... PO Data : ', poData);

            return returnValue;
        },
        fetchPOData: function (poNumList) {
            var logTitle = [LogTitle, 'fetchPOData'].join('::');

            var listPOData = {};
            var searchOption = {
                type: 'purchaseorder',

                filters: [
                    ['mainline', 'is', 'T'],
                    'AND',
                    ['type', 'anyof', 'PurchOrd'],
                    'AND',
                    // Build an NS formula filter that matches any of the supplied PO numbers in bulk.
                    // NetSuite does not support large OR filter chains efficiently, so we use a SQL INSTR trick:
                    //   serialize PO numbers into a CSV string, then test if each PO number appears inside it.
                    // PO numbers are chunked to keep the SQL expression length within safe limits.
                    (function (poNums, chunkSize) {
                        if (!chunkSize) chunkSize = 10;

                        var formulaParts = [];
                        for (var i = 0; i < poNums.length; i += chunkSize) {
                            var chunk = poNums.slice(i, i + chunkSize);
                            // Wrap in leading/trailing commas so partial matches (e.g. 'PO1' inside 'PO10') don't fire
                            var csv = ',' + chunk.join(',') + ','; // e.g. ",PO15418,PO15331,...,"

                            // INSTR returns > 0 if {number} is found inside the CSV string
                            formulaParts.push("INSTR('" + csv + "', ',' || {number} || ',') > 0");

                            if (MainConfig.overridePONum) {
                                // Also test against the override PO number field when that config is enabled
                                formulaParts.push(
                                    "INSTR('" +
                                        csv +
                                        "', ',' || {custbody_ctc_vc_override_ponum} || ',') > 0"
                                );
                            }
                        }

                        // Combine all chunk conditions into a single CASE WHEN SQL expression
                        var formula =
                            'CASE WHEN (' + formulaParts.join(' OR ') + ") THEN 'Y' ELSE 'N' END";

                        // Return as a formulatext filter compatible with ns_search.create()
                        return ['formulatext: ' + formula, 'is', 'Y'];
                    })(poNumList, 10)
                ],
                columns: [
                    'internalid',
                    'trandate',
                    'type',
                    'postingperiod',
                    'tranid',
                    'entity',
                    'amount',
                    MainConfig.overridePONum ? 'custbody_ctc_vc_override_ponum' : 'tranid',
                    vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES ? 'subsidiary' : 'tranid'
                ]
            };
            vc2_util.log(logTitle, '... search option: ', searchOption);
            var searchObj = ns_search.create(searchOption);
            if (!searchObj.runPaged().count) {
                vc2_util.log(logTitle, 'PO Data not found!', { list: poNumList });
                return false;
            }

            var searchResults = searchObj.run().getRange({ start: 0, end: 1000 });
            searchResults.forEach(function (searchResult) {
                var poData = {
                    id: searchResult.getValue({ name: 'internalid' }),
                    entityId: searchResult.getValue({ name: 'entity' }),
                    entityName: searchResult.getText({ name: 'entity' }),
                    tranId: searchResult.getValue({ name: 'tranid' }),
                    date: searchResult.getValue({ name: 'trandate' }),
                    subsidiary: vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES
                        ? searchResult.getValue({ name: 'subsidiary' })
                        : null
                };
                listPOData[poData.tranId] = poData;

                // if overridePO exists, map it too
                if (MainConfig.overridePONum) {
                    var overridePONum = searchResult.getValue({
                        name: 'custbody_ctc_vc_override_ponum'
                    });
                    if (overridePONum && overridePONum != poData.tranId) {
                        listPOData[overridePONum] = poData;
                    }
                }
            });

            vc2_util.dumpLog(logTitle, listPOData, '... PO Data List : ');

            return listPOData;
        },
        billFileExists: function (option, allBillFileData) {
            var logTitle = [LogTitle, 'searchBillFile'].join('::'),
                returnValue;

            var BillCreator = vc2_constant.Bill_Creator;
            if (!option || !option.invoice) return false;

            var invoiceNo = option.invoice.toString().trim();
            var invalidBillFiles = [],
                arrErrors = [];

            vc2_util.LogPrefix = LogPrefix;

            var arrInvoiceData = allBillFileData[invoiceNo];

            // no existing match,
            if (vc2_util.isEmpty(arrInvoiceData)) {
                vc2_util.log(logTitle, '.. no existing bill file found');
                return false;
            }

            // look for the valid bill file
            // Among all bill files for this invoice, isolate those already linked to a Vendor Bill record
            var listLinkedBill = arrInvoiceData.filter(function (billFileData) {
                return billFileData.linkedBill;
            });

            // Of those linked, find the one that was fully PROCESSED (most authoritative / definitive match)
            var linkedBillProcessed = !vc2_util.isEmpty(listLinkedBill)
                ? listLinkedBill.filter(function (billFileData) {
                      return (
                          billFileData.linkedBill &&
                          billFileData.procStatus == BillCreator.Status.PROCESSED
                      );
                  })
                : false;

            // Determine the single canonical "already-billed" file:
            //   1st priority: a PROCESSED linked bill file (definitive)
            //   2nd priority: the sole linked bill file if there's exactly one (closed/other status)
            //   null = no clear valid linked bill exists
            var validLinkedBill =
                linkedBillProcessed.length > 0
                    ? // the first linkedBilledProcess is the validBillFile
                      linkedBillProcessed[0]
                    : listLinkedBill.length == 1
                      ? //.. or, its the other linkedBillCloseds
                        listLinkedBill[0]
                      : null;

            // if there is only 1 bill file, and it is already linked to a processed bill, return true
            if (arrInvoiceData.length == 1 && validLinkedBill) {
                vc2_util.log(logTitle, '.. valid processed/closed bill file: ', validLinkedBill);
                return true;
            }

            // initial value
            var hasValidBillFile = !vc2_util.isEmpty(validLinkedBill);

            arrInvoiceData.forEach(function (billFileData) {
                vc2_util.log(logTitle, '*** Validate: Bill File : ', billFileData);
                try {
                    // If this bill file is already linked to a bill, check if it's the processed one.
                    // If so, it's valid; otherwise, it's a duplicate and should throw an error.
                    if (billFileData.linkedBill) {
                        if (validLinkedBill && validLinkedBill.id == billFileData.id) return true;
                        else throw 'Duplicate linkedBill bill file';
                    }

                    // check if this is a valid bill file
                    if (!Helper.isValidBillFile(billFileData, arrErrors)) throw 'Invalid bill file';

                    // if there's an existing bill file
                    if (hasValidBillFile) throw 'Duplicate bill file';

                    // no issues, this is a validbillfile
                    hasValidBillFile = true;
                } catch (validate_error) {
                    vc2_util.logWarn(logTitle, validate_error);
                    invalidBillFiles.push(billFileData);
                    return false;
                }

                return true;
            });

            vc2_util.log(logTitle, '... Bill File Check result:  ', [
                hasValidBillFile,
                invalidBillFiles,
                arrErrors
            ]);

            if (!vc2_util.isEmpty(invalidBillFiles)) {
                invalidBillFiles.forEach(function (row) {
                    ns_record.delete({ type: 'customrecord_ctc_vc_bills', id: row.id });
                });
            }

            if (hasValidBillFile) {
                vc2_util.logWarn(logTitle, '... Bill File already exists: ', [option]);
                returnValue = true;
            } else {
                vc2_util.logWarn(
                    logTitle,
                    ' ***** Bill File already exists, but has errors: Deleted invalid bill files ***** '
                );

                /// then return false to re-download the billfile
                returnValue = false;
            }

            return returnValue;
        },
        fetchInvoiceData: function (invoiceNumList) {
            var logTitle = [LogTitle, 'fetchInvoiceData'].join('::'),
                returnValue;
            var invoiceNumFilters = [];
            invoiceNumList.forEach(function (invoiceNum) {
                if (!invoiceNum) return;
                if (invoiceNumFilters.length) invoiceNumFilters.push('OR');
                invoiceNumFilters.push(['custrecord_ctc_vc_bill_number', 'is', invoiceNum]);
            });

            var searchObj = ns_search.create({
                type: 'customrecord_ctc_vc_bills',
                filters: [['isinactive', 'is', 'F'], 'AND', invoiceNumFilters],
                columns: [
                    'id',
                    'name',
                    'custrecord_ctc_vc_bill_number',
                    'custrecord_ctc_vc_bill_json',
                    'custrecord_ctc_vc_bill_linked_bill',
                    'custrecord_ctc_vc_bill_proc_status',
                    'custrecord_ctc_vc_bill_linked_po'
                    // ns_search.createColumn({ name: 'internalid', sort: ns_search.Sort.DESC })
                ]
            });
            if (!searchObj.runPaged().count) {
                vc2_util.log(logTitle, 'Invoice Data not found!', invoiceNumList);
                return false;
            }

            var listInvoiceData = {};
            var searchResults = searchObj.run().getRange({ start: 0, end: 1000 });
            searchResults.forEach(function (searchResult) {
                var invoiceData = {
                    id: searchResult.getValue({ name: 'id' }),
                    tranId: searchResult.getValue({ name: 'custrecord_ctc_vc_bill_number' }),
                    jsonData: searchResult.getValue({ name: 'custrecord_ctc_vc_bill_json' }),
                    procStatus: searchResult.getValue({
                        name: 'custrecord_ctc_vc_bill_proc_status'
                    }),
                    procStatusText: searchResult.getText({
                        name: 'custrecord_ctc_vc_bill_proc_status'
                    }),
                    linkedBill: searchResult.getValue({
                        name: 'custrecord_ctc_vc_bill_linked_bill'
                    }),
                    linkedPO: searchResult.getValue({
                        name: 'custrecord_ctc_vc_bill_linked_po'
                    })
                };

                if (!listInvoiceData[invoiceData.tranId]) listInvoiceData[invoiceData.tranId] = [];
                listInvoiceData[invoiceData.tranId].push(invoiceData);
            });
            returnValue = listInvoiceData;
            vc2_util.log(logTitle, '... Invoice Data : ', listInvoiceData);
            return returnValue;
        },
        loadVendorConfig: function (option) {
            var logTitle = [LogTitle, 'loadVendorConfig'].join('::'),
                returnValue;
            var entityId = option.entity;
            var BILLCREATE_CFG = vc2_constant.RECORD.BILLCREATE_CONFIG;

            try {
                // Pull all BILLCREATE_CFG fields via a vendor search with join to the bill config entity,
                // avoiding a separate record.load() call on the config record
                var searchOption = {
                    type: 'vendor',
                    filters: [['internalid', 'anyof', entityId]],
                    columns: [] // populated dynamically below from the BILLCREATE_CFG field map
                };

                // Build the column list from the constant field map so new config fields are picked up automatically
                for (var field in BILLCREATE_CFG.FIELD) {
                    searchOption.columns.push(
                        ns_search.createColumn({
                            name: BILLCREATE_CFG.FIELD[field],
                            join: vc2_constant.FIELD.ENTITY.BILLCONFIG // traverse to the linked bill config record
                        })
                    );
                }

                var searchObj = ns_search.create(searchOption);
                if (!searchObj.runPaged().count) throw 'No config available';

                returnValue = {};
                searchObj.run().each(function (row) {
                    for (var field in BILLCREATE_CFG.FIELD) {
                        returnValue[field] = row.getValue({
                            name: BILLCREATE_CFG.FIELD[field],
                            join: vc2_constant.FIELD.ENTITY.BILLCONFIG
                        });
                    }
                    return true;
                });

                vc2_util.log(logTitle, '// config: ', returnValue);
            } catch (error) {
                vc2_util.logWarn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        isItemMatchRL: function (option) {
            var logTitle = [LogTitle, 'isFuseMatch'].join('::'),
                returnValue = false;

            try {
                // Call the Item Match Restlet with a fuzzy/fuse search payload;
                // this offloads heavy item-matching logic to a dedicated restlet to preserve governance units
                var fuzzyResp = ns_https.requestRestlet({
                    headers: { 'Content-Type': 'application/json' },
                    scriptId: vc2_constant.SCRIPT.ITEM_MATCH_RL,
                    deploymentId: vc2_constant.DEPLOYMENT.ITEM_MATCH_RL,
                    method: 'POST',
                    body: JSON.stringify({
                        list: option.list,
                        keys: option.searchKeys,
                        searchValue: option.value
                    })
                });
                var results = JSON.parse(fuzzyResp.body);
                vc2_util.log(logTitle, '/// Fuse match: ', results);

                if (results.match) {
                    returnValue = true;
                }
            } catch (match_error) {
                vc2_util.logWarn(logTitle, match_error);
            }

            return returnValue;
        },
        lookupVendorTerms: function (entityId) {
            var logTitle = [LogTitle, 'lookupVendorTerms'].join('::'),
                returnValue = 0; // return 0 (no terms) as a safe default
            try {
                var searchTerms = ns_search.lookupFields({
                    type: ns_search.Type.VENDOR,
                    id: entityId,
                    columns: ['terms']
                });

                // terms is a multi-select; take the first value if present
                if (searchTerms && searchTerms.terms) {
                    returnValue = searchTerms.terms[0].value;
                }
            } catch (error) {
                vc2_util.logWarn(logTitle, error);
            }

            return returnValue;
        },
        fetchVendorDueDate: function (entityId) {
            var logTitle = [LogTitle, 'fetchVendorDueDate'].join('::'),
                returnValue = null;
            try {
                // IIFE cache pattern: try NS persistent cache first; on miss, fetch from NS and store result.
                // Prevents redundant lookupFields calls for the same vendor across multiple bill lines in one run.
                var vendorTerms =
                    vc2_util.getNSCache({
                        cacheKey: ['vendorTerms', entityId].join(':') // cache key scoped to this vendor
                    }) ||
                    (function () {
                        var terms,
                            searchTerms = ns_search.lookupFields({
                                type: ns_search.Type.VENDOR,
                                id: entityId,
                                columns: ['terms']
                            });
                        if (searchTerms.terms.length > 0) {
                            terms = searchTerms.terms[0].value; // internalid of the Terms record
                            // Persist so subsequent calls for the same vendor avoid a DB hit
                            vc2_util.setNSCache({
                                cacheKey: ['vendorTerms', entityId].join(':'),
                                value: terms
                            });
                        }
                        return terms;
                    })();

                if (!vendorTerms) throw 'No payment terms found';

                // Second IIFE cache: resolve the Term record's net-due days.
                // Cached separately since multiple vendors may share the same Terms record.
                var daysToPay =
                    vc2_util.getNSCache({
                        cacheKey: ['termsDays', vendorTerms].join(':') // cache key scoped to the Terms record ID
                    }) ||
                    (function () {
                        var days,
                            searchTerms = ns_search.lookupFields({
                                type: ns_search.Type.TERM,
                                id: vendorTerms,
                                columns: ['daysuntilnetdue']
                            });
                        if (searchTerms.daysuntilnetdue) {
                            days = parseInt(searchTerms.daysuntilnetdue); // net days as integer
                            vc2_util.setNSCache({
                                cacheKey: ['termsDays', vendorTerms].join(':'),
                                value: days
                            });
                        }
                        return days;
                    })();

                if (isNaN(parseInt(daysToPay, 10))) throw 'No days found for terms'; // fail fast if Terms record has no day value
                returnValue = daysToPay;
            } catch (error) {
                vc2_util.logWarn(logTitle, error);
            }

            return returnValue;
        },
        isValidBillFile: function (billFileData, arrErrors) {
            var logTitle = [LogTitle, 'isValidBillFile'].join('::'),
                returnValue;

            var BillCreator = vc2_constant.Bill_Creator;
            // Ensure arrErrors is always a valid array so callers can inspect individual failure reasons
            if (typeof arrErrors === 'undefined' || !util.isArray(arrErrors)) arrErrors = [];

            try {
                // Guard: a bill file without a linked PO can never be processed into a vendor bill
                if (!billFileData.linkedPO) throw 'PO Link is not found';

                // Only PENDING and ERROR bill files need full validation; other statuses
                // (e.g. PROCESSED, CLOSED) are already resolved — skip and return valid early
                if (
                    !vc2_util.inArray(billFileData.procStatus, [
                        BillCreator.Status.PENDING,
                        BillCreator.Status.ERROR
                    ])
                )
                    return true;

                // Safely parse the stored JSON payload; an unparseable or empty payload means
                // the retrieval step failed and the bill file cannot be processed
                var parsedJSON = vc2_util.safeParse(billFileData.jsonData);
                if (!parsedJSON || !parsedJSON.lines || !parsedJSON.lines.length)
                    throw 'Invalid JSON data';

                // Per-line validation: every line with a positive quantity must carry an ITEMNO
                // so it can be matched to a NS PO line during bill creation
                parsedJSON.lines.forEach(function (line) {
                    var lineQty = line.hasOwnProperty('QUANTITY') ? line.QUANTITY : 0;
                    if (lineQty <= 0) return true; // zero-qty lines are informational only — skip
                    if (!line.hasOwnProperty('ITEMNO')) {
                        throw 'Invalid JSON data - missing ITEMNO';
                    }
                    return true;
                });

                returnValue = true;
            } catch (validate_error) {
                // Collect the error into arrErrors so the caller can surface all reasons at once
                vc2_util.logWarn(logTitle, validate_error);
                arrErrors.push(validate_error);
                returnValue = false;
            }

            return returnValue;
        }
    };

    var dateFormat;
    function process(configObj, billDataArr, name) {
        var logTitle = [LogTitle, 'process'].join('::');

        vc2_util.log(logTitle, '**** START process ****  ', {
            config: configObj,
            name: name
        });

        MainConfig = vcs_configLib.mainConfig();

        // //4.01
        if (!dateFormat) {
            var generalPref = ns_config.load({
                type: ns_config.Type.COMPANY_PREFERENCES
            });
            dateFormat = generalPref.getValue({ fieldId: 'DATEFORMAT' });
            vc2_util.log(logTitle, '>> dateFormat: ', dateFormat);
        }

        try {
            if (!billDataArr || !billDataArr.length) throw 'Empty response';

            // --- PRELOAD PHASE ---
            // Collect all distinct PO numbers and invoice numbers from the batch upfront, then
            // batch-fetch their NS data in a single search each. This avoids per-iteration record
            // loads and minimises governance unit consumption.

            // Extract and deduplicate all PO numbers referenced in this batch
            var arrPONums = billDataArr.map(function (item) {
                var poNum = item.ordObj && item.ordObj.po;
                if (!poNum) return;
                return poNum.toString().trim();
            });
            arrPONums = vc2_util.uniqueArray(arrPONums); // remove duplicates
            vc2_util.log(logTitle, '... arrPONums: ', arrPONums);

            // Batch fetch PO header data → keyed by tranId for O(1) lookup inside the loop
            var arrPOData = Helper.fetchPOData(arrPONums);

            // Extract and deduplicate all invoice numbers referenced in this batch
            var arrInvoiceNums = billDataArr.map(function (item) {
                var invoiceNum = item.ordObj && item.ordObj.invoice;
                if (!invoiceNum) return;
                return invoiceNum.toString().trim();
            });

            // Batch fetch existing bill file records → keyed by invoice number for O(1) duplicate detection
            var arrInvoiceData = Helper.fetchInvoiceData(arrInvoiceNums);

            for (var i = 0; i < billDataArr.length; i++) {
                var billObj = billDataArr[i].ordObj;
                LogPrefix = '[' + billObj.invoice + '] ';
                vc2_util.LogPrefix = LogPrefix;

                vc2_util.log(logTitle, '###### PROCESSING [' + billObj.invoice + '] ######');
                vc2_util.log(logTitle, { idx: i, data: billDataArr[i] });

                if (Helper.billFileExists(billObj, arrInvoiceData)) {
                    vc2_util.log(logTitle, '...already exists, skipping');
                    continue;
                }

                vc2_util.log(logTitle, ' /// Initiate bill file record.');

                // Accumulates human-readable audit notes that are stored on custrecord_ctc_vc_bill_log
                var billFileNotes = [];

                // Seed the bill file record with data from the vendor payload
                var billFileValues = {
                    name: [name, billObj.invoice].join(':'), // Display name: "configName:invoiceNo"
                    custrecord_ctc_vc_bill_file_position: i + 1, // Ordinal position within this batch
                    custrecord_ctc_vc_bill_po: billObj.po, // Raw vendor PO number string
                    custrecord_ctc_vc_bill_number: billObj.invoice, // Vendor invoice number
                    custrecord_ctc_vc_bill_date: moment(billObj.date, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(), // [ CodeMaster ] CST-5022: explicit format array + strict mode
                    custrecord_ctc_vc_bill_proc_status: 1, // 1 = PENDING (initial status)
                    custrecord_ctc_vc_bill_integration: configObj.id, // Bill vendor config record ID
                    custrecord_ctc_vc_bill_src: billDataArr[i].xmlStr // Original raw XML/JSON source string
                };

                var dueDate = null,
                    manualDueDate = false,
                    poNum = billObj.po.toString().trim(); // normalised for map lookup

                // If the vendor payload explicitly provides a due date, use it directly and skip auto-calculation
                if (billObj.hasOwnProperty('duedate') == true) {
                    dueDate = billObj.duedate;
                    manualDueDate = true;
                }

                var poData = arrPOData ? arrPOData[poNum] : null;
                vc2_util.log(logTitle, '... PO Data: ', poData);

                if (!poData) {
                    billFileNotes.push('PO Link is not found : [' + billObj.po + ']');
                } else {
                    // load the vendor config
                    billFileValues['custrecord_ctc_vc_bill_linked_po'] = poData.id;
                    billFileNotes.push('Linked to PO: ' + poData.tranId + ' (' + poData.id + ') ');

                    BillCFG = vcs_configLib.billVendorConfig({ poId: poData.id });
                    VendorCFG = vcs_configLib.orderVendorConfig({ poId: poData.id });

                    if (BillCFG && BillCFG.enableFulfillment)
                        billFileValues['custrecord_ctc_vc_bill_is_recievable'] = true;

                    // Only calculate due date if it wasn't manually provided
                    if (!manualDueDate) {
                        var dueDays = Helper.fetchVendorDueDate(poData.entityId);
                        if (dueDays !== null) {
                            dueDate = moment(billObj.date, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true) // [ CodeMaster ] CST-5022: explicit format array + strict mode
                                .add(parseInt(dueDays), 'days')
                                .format('MM/DD/YYYY');
                            billFileNotes.push(
                                'Due date calculated based on vendor terms (' + dueDays + ' days)'
                            );
                        } else {
                            billFileNotes.push('No due date available');
                        }
                    } else {
                        billFileNotes.push('Due date provided by file');
                    }
                }

                if (dueDate !== null) {
                    billFileValues.custrecord_ctc_vc_bill_due_date = moment(dueDate, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(); // [ CodeMaster ] CST-5022: explicit format array + strict mode
                    if (manualDueDate) {
                        billFileValues.custrecord_ctc_vc_bill_due_date_f_file = true;
                    }
                }

                var ii;

                if (poData && poData.id) {
                    // --- ITEM MATCHING PHASE ---
                    // For each vendor bill line, find the matching NS PO line item so we can stamp
                    // the NS item internalid (NSITEM) onto the bill file for downstream bill creation.

                    // Fetch PO lines with the item-identification columns needed by the item matcher
                    var poLines = vcs_recordLib.searchTransactionLines({
                        recordId: poData.id,
                        recordType: 'purchaseorder',
                        columns: [
                            vc2_constant.GLOBAL.ITEM_ID_LOOKUP_COL, // vendor-facing item ID lookup col
                            vc2_constant.GLOBAL.VENDOR_SKU_LOOKUP_COL, // vendor SKU lookup col
                            vc2_constant.FIELD.TRANSACTION.DH_MPN, // D&H MPN field
                            vc2_constant.FIELD.TRANSACTION.DELL_QUOTE_NO, // Dell quote number field
                            VendorCFG.itemColumnIdToMatch || // vendor-specific item col (priority)
                                MainConfig.itemColumnIdToMatch ||
                                'item',
                            VendorCFG.itemMPNColumnIdToMatch || // vendor-specific MPN col (priority)
                                MainConfig.itemMPNColumnIdToMatch ||
                                'item'
                        ]
                    });
                    var arrMatchedSKU = []; // tracks all NS item internalids successfully matched this iteration

                    billObj.lines.forEach(function (billFileLine) {
                        // Normalize the bill file line into the standard vendorLine shape expected by isItemMatched
                        var vendorLine = vc2_util.extend(billFileLine, {
                            ITEM_TEXT: billFileLine.ITEMNO || 'NA', // primary item identifier from vendor
                            ITEM_ALT: billFileLine.ITEMNO_EXT || 'NA', // alternate identifier (e.g. extended part number)
                            ITEM_SKU: billFileLine.ITEMNO_EXT || 'NA' // SKU alias
                        });

                        var logPrefix = '//  [' + vendorLine.ITEM_TEXT + '] ',
                            matchedLine; // holds the first PO line that matches this vendor line

                        for (var ii = 0, jj = poLines.length; ii < jj; ii++) {
                            var poLine = poLines[ii];
                            vc2_util.log(logTitle, logPrefix + '... testing for PO Line:  ', [
                                poLine,
                                billFileLine
                            ]);

                            var isMatched =
                                // Stage 1: direct item name / SKU / MPN comparison
                                vcs_itemMatchLib.isItemMatched({
                                    vendorLine: vendorLine,
                                    poLine: poLine,
                                    orderConfig: VendorCFG,
                                    mainConfig: MainConfig
                                }) ||
                                // Stage 2: match against alt-name fields configured on the NS item record
                                (function () {
                                    // fetchItemAltNames is internally cached; safe to call per line
                                    var listAltNames = vcs_itemMatchLib.fetchItemAltNames({
                                        orderLines: poLines,
                                        vendorConfig: VendorCFG,
                                        mainConfig: MainConfig
                                    });
                                    vc2_util.log(logTitle, '... Alt Names: ', listAltNames);
                                    return vcs_itemMatchLib.isItemAltMatched({
                                        vendorLine: vendorLine,
                                        poLine: poLine,
                                        listAltNames: listAltNames,
                                        orderConfig: VendorCFG,
                                        mainConfig: MainConfig
                                    });
                                })();

                            if (isMatched) {
                                matchedLine = poLine;
                                break; // stop at first match; PO lines are unique by item
                            }
                        }

                        vc2_util.log(logTitle, logPrefix + '.. matched ? ', matchedLine);

                        if (!matchedLine) {
                            // Log unmatched SKU as a note on the bill file for user review
                            billFileNotes.push('Not matched SKU: ' + vendorLine.ITEMNO);
                            vc2_util.log(logTitle, logPrefix + '.. item match not found. ');
                        } else {
                            // Stamp the NS item internalid onto the bill file line for bill creation
                            billFileLine.NSITEM = matchedLine.item;
                            billFileLine.ITEMNO = billFileLine.ITEMNO || matchedLine.item_text; // fall back to NS item name
                            arrMatchedSKU.push(matchedLine.item);
                        }
                    });
                } else {
                    // PO not found — blank out NSITEM on all lines so the bill file is still created
                    // but marked accordingly (PO Link not found note is already added above)
                    for (ii = 0; ii < billObj.lines.length; ii++) {
                        billObj.lines[ii].NSITEM = '';
                    }
                }

                billFileValues['custrecord_ctc_vc_bill_json'] = JSON.stringify(billObj);
                billFileValues['custrecord_ctc_vc_bill_log'] = addNote({
                    note: billFileNotes.join(' | ')
                });

                // --- SAVE PHASE ---
                // Create the Bill File (customrecord_ctc_vc_bills) record and stamp all collected field values
                var objRecord = ns_record.create({
                    type: 'customrecord_ctc_vc_bills',
                    isDynamic: true
                });

                // Set each collected field value onto the record in dynamic mode
                for (var fieldId in billFileValues) {
                    objRecord.setValue({
                        fieldId: fieldId,
                        value: billFileValues[fieldId]
                    });
                }
                var record_id = objRecord.save();

                vc2_util.vcLog({
                    title: 'Bill File',
                    message: 'Created bill file |' + [record_id, billFileValues.name].join(' - '),
                    details: billFileValues,
                    status: LOG_STATUS.SUCCESS
                });

                vc2_util.log(logTitle, '>> Bill File created: ' + record_id);
            }
        } catch (error) {
            // Fixed: use the defined error map constant to avoid ReferenceError in the catch path.
            vclib_error.warn(logTitle, error, ERROR_MSG);
            throw error;
        }

        vc2_util.log(logTitle, '**** END process ****  ');

        return null;
    }

    function addNote(option) {
        var logTitle = [LogTitle, 'addNote'].join('::');

        vc2_util.log(logTitle, option);

        var billFileId = option.billFileId || option.billId || option.id,
            notes = option.note || option.notes || option.content,
            allNotes = option.all || option.allNotes || option.current || '';

        // //4.01
        if (!dateFormat) {
            var generalPref = ns_config.load({
                type: ns_config.Type.COMPANY_PREFERENCES
            });
            dateFormat = generalPref.getValue({ fieldId: 'DATEFORMAT' });
        }

        // get the current notes
        if (billFileId) {
            var recData = ns_search.lookupFields({
                type: 'customrecord_ctc_vc_bills',
                id: billFileId,
                columns: ['custrecord_ctc_vc_bill_log']
            });
            allNotes = recData.custrecord_ctc_vc_bill_log;
        }
        // Prepend the new note with today's date for the audit trail
        if (notes) allNotes = allNotes + '\r\n' + moment().format('MM/DD/YYYY') + ' - ' + notes;

        // Deduplicate note lines to prevent the same line from accumulating on repeated runs
        var arrNotes = [];
        allNotes.split(/\r\n/).map(function (line) {
            if (arrNotes.indexOf(line) < 0) arrNotes.push(line); // only add unique lines
            return true;
        });
        var newNoteStr = arrNotes.join('\r\n');

        if (billFileId) {
            // update
            ns_record.submitFields({
                type: 'customrecord_ctc_vc_bills',
                id: billFileId,
                values: {
                    custrecord_ctc_vc_bill_log: newNoteStr
                },
                options: {
                    ignoreMandatoryFields: true
                }
            });
        }

        return newNoteStr;
    }

    // Public API exposed by this library module
    return {
        mainConfig: MainConfig, // module-level main config ref (null until process() is called)
        process: process, // main entry point: process a batch of vendor bill payloads into bill file records
        addNote: addNote // utility: append a timestamped note to a bill file's log field
    };
});
