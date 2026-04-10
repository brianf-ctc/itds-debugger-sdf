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
 * Script Name: VC Services | Transaction Library
 *
 * @author brianf@nscatalyst.com
 * @description Service library for creating, validating, and managing NetSuite transactions (fulfillments, bills, receipts).
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Fixed shipped validation to use vendorLine.NOTSHIPPED; auto-load poRec in updatePurchaseOrder; return vendorLines with save result
 * 2026-03-18   brianf        Fixed service module naming violations (vcs_recordlib, vcs_configlib, vcs_itemmatch); replaced remaining util.extend with
 *                            vc2_util.extend
 * 2026-02-01   brianf        Updated script header, changelog, and added/expanded inline comments and JSDoc for Helper methods
 * 2026-01-31   brianf        Added searchTransaction function for transaction search utility
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
/** 
 * USAGE
 * 
 * 1. Create Item Fulfillment:
 *    createFulfillment({
 *      poId: <string>,           // Purchase Order ID
 *      soId: <string>,           // Sales Order ID (optional if PO is linked to SO)
 *      vendorLines: [{           // Array of vendor line items
 *        ITEMNO: <string>,       // Item number/SKU
 *        QUANTITY: <number>,     // Quantity to fulfill
 *        SERIAL: <string>,       // Serial numbers (comma-separated)
 *        TRACKING: <string>      // Tracking numbers (comma-separated)
 *      }],
 *      headerValues: {           // Optional header field values
 *        trandate: <date>,
 *        tranid: <string>
 *      }
 *    })
 * 
 * 2. Validate Fulfillment:
 *    validateForFulfillment({
 *      poId: <string>,          // Purchase Order ID
 *      vendorLines: []          // Array of vendor line items
 *    })
 * 
 * 3. Create Bill:
 *    createBill({
 *      poId: <string>,          // Purchase Order ID
 *      vendorLines: []          // Array of vendor line items
 *    })
 * 

 */

define(function (require) {
    var LogTitle = 'SVC:Transaction';

    // Fixed: Reordered imports by type per standards (NetSuite → Library → Service → Legacy)
    var ns_search = require('N/search'),
        ns_runtime = require('N/runtime'),
        ns_util = require('N/util'),
        ns_record = require('N/record');

    var vclib_error = require('./lib/ctc_lib_error.js'),
        vclib_util = require('./lib/ctc_lib_utils.js');

    var vcs_configlib = require('./ctc_svclib_configlib.js'),
        vcs_itemmatch = require('./ctc_svclib_itemmatch.js'),
        vcs_recordlib = require('./ctc_svclib_records.js');

    var vc2_util = require('./../CTC_VC2_Lib_Utils.js'),
        vc2_constant = require('./../CTC_VC2_Constants.js');

    var CACHE_TTL = 300; // store the data for 1mins
    var LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

    var ERROR_LIST = {
        SERIALS_NOT_REQUIRED: {
            code: 'SERIALS_NOT_REQUIRED',
            message: 'Line does not require serial numbers',
            level: vclib_error.ErrorLevel.WARNING
        },
        FEATURE_NOT_ENABLED: {
            code: 'FEATURE_NOT_ENABLED',
            message: 'Feature is not enabled',
            level: vclib_error.ErrorLevel.WARNING
        },
        LOAD_ERROR: {
            code: 'LOAD_ERROR',
            message: 'Failed to load the record'
        },
        MATCH_NOT_FOUND: {
            code: 'MATCH_NOT_FOUND',
            message: 'Unmatched line',
            level: vclib_error.ErrorLevel.WARNING
        },
        LINE_FULFILLED: {
            code: 'LINE_FULFILLED',
            message: 'Already fulfilled or not fulfillable',
            level: vclib_error.ErrorLevel.WARNING
        },
        INSUFFICIENT_QTY: {
            code: 'INSUFFICIENT_QTY',
            message: 'Insufficient quantity',
            level: vclib_error.ErrorLevel.WARNING
        },
        FULLY_RECEIVED: {
            code: 'FULLY_RECEIVED',
            message: 'Item already fully received/fulfilled',
            level: vclib_error.ErrorLevel.WARNING
        },
        TRANSFORM_ERROR: {
            code: 'TRANSFORM_ERROR',
            message: 'Error transforming record'
        },
        FULFILLMENT_ERROR: {
            code: 'FULFILLMENT_ERROR',
            message: 'Error creating fulfillment'
        },
        NO_FULFILLABLE_LINES: {
            code: 'NO_FULFILLABLE_LINES',
            message: 'No fulfillable lines found',
            level: vclib_error.ErrorLevel.WARNING
        },
        FULFILLMENT_VALIDATION_ERROR: {
            code: 'FULFILLMENT_VALIDATION_ERROR',
            message: 'Fulfillment validation error'
        },
        UNFULFILLABLE_LINES: {
            code: 'UNFULFILLABLE_LINES',
            message: 'Unfulfillable item/s found and is not allowed on Main Config',
            level: vclib_error.ErrorLevel.WARNING
        },
        UNFULFILLABLE_ITEM: {
            code: 'UNFULFILLABLE_ITEM',
            message: 'Unable to fulfill'
        },
        NOT_SHIPPED: {
            code: 'NOT_SHIPPED',
            message: 'Not shipped',
            level: vclib_error.ErrorLevel.WARNING
        },
        HAS_UNSHIPPED_ITEMS: {
            code: 'HAS_UNSHIPPED_ITEMS',
            message: 'Has unshipped item/s',
            level: vclib_error.ErrorLevel.WARNING
        },
        FF_VALIDATE_ERROR: {
            code: 'FF_VALIDATE_ERROR',
            message: 'Fulfillment Error Detected'
        }
    };

    var RECORD_NAMES = {};
    RECORD_NAMES[ns_record.Type.ITEM_FULFILLMENT] = {
        code: 'ITEM_FULFILLMENT',
        name: 'Item Fulfillment'
    };
    RECORD_NAMES[ns_record.Type.ITEM_RECEIPT] = {
        code: 'ITEM_RECEIPT',
        name: 'Item Receipt'
    };

    // Fixed: Added name reference for the returned library object per standards

    var Helper = {
        /**
         * Checks if the accounting period for the given record is locked for posting.
         * @param {Object} option - Options object
         * @param {Record} option.record - NetSuite record instance
         * @returns {boolean} True if period is locked, false otherwise
         */
        isPeriodLocked: function (option) {
            var logTitle = [LogTitle, 'Helper:isPeriodLocked'].join('|'),
                returnValue;
            option = option || {};

            var record = option.record;
            var isLocked = false;
            var periodValues = ns_search.lookupFields({
                type: ns_search.Type.ACCOUNTING_PERIOD,
                id: record.getValue({ fieldId: 'postingperiod' }),
                columns: ['aplocked', 'alllocked', 'closed']
            });

            // If any lock/closed flag is true, period is locked
            isLocked = periodValues.aplocked || periodValues.alllocked || periodValues.closed;
            vc2_util.log(logTitle, '>> isPeriodLocked? ', isLocked);
            returnValue = isLocked;

            return returnValue;
        },

        /**
         * Processes and formats vendor line data according to field definitions and mapping.
         * @param {Object} option - Options object
         * @param {Object} option.vendorLine - Vendor line data
         * @param {Object} [option.poLineValue] - PO line values
         * @param {Object} [option.currentLine] - Current line values
         * @param {Object} [option.mainConfig] - Main config object
         * @param {number} [option.quantity] - Quantity for serial slicing
         * @param {number} [option.runningQty] - Running quantity for serial slicing
         * @returns {Object} Formatted line data
         */
        setVendorLineValues: function (option) {
            var logTitle = [LogTitle, 'Helper:setVendorLineValues'].join('|'),
                returnValue = {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                var vendorLine = option.vendorLine,
                    poLineValue = option.poLineValue || {},
                    currentLine = option.currentLine || {};

                var mainConfig = option.mainConfig || vcs_configlib.mainConfig();

                // Fixed: Use vclib_util type check instead of global util
                if (vc2_util.isEmpty(vendorLine) || !ns_util.isObject(vendorLine))
                    throw { code: 'MISSING_PARAMETER', details: 'vendorLine' };

                var VENDOR_COLS = vc2_constant.VENDOR_LINE_DEF.VENDORLINE_COLS,
                    ORDERLINE_COLS = vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS,
                    FIELD_DEF = vc2_constant.VENDOR_LINE_DEF.FIELD_DEF,
                    MAPPING = vc2_constant.VENDOR_LINE_DEF.MAPPING;

                var lineData = {};
                VENDOR_COLS.forEach(function (vendorCol) {
                    ORDERLINE_COLS.forEach(function (orderCol) {
                        // Only map columns that match in the mapping
                        if (MAPPING[orderCol] !== vendorCol) return;

                        var fldValue = vendorLine[vendorCol],
                            poFldValue = poLineValue[orderCol],
                            curLineValue = currentLine[orderCol];

                        // Handle field types
                        if (vc2_util.inArray(orderCol, FIELD_DEF.DATE)) {
                            if (vc2_util.isEmpty(fldValue) || fldValue == 'NA') return;
                            fldValue = vc2_util.parseToNSDate(fldValue);
                        } else if (vc2_util.inArray(orderCol, FIELD_DEF.TEXT)) {
                            fldValue =
                                vc2_util.isEmpty(fldValue) || fldValue == 'NA' ? 'NA' : fldValue;
                        } else if (vc2_util.inArray(orderCol, FIELD_DEF.TEXT_LIST)) {
                            if (vc2_util.isEmpty(fldValue) || fldValue == 'NA') return;

                            poFldValue = !vc2_util.isEmpty(poFldValue)
                                ? poFldValue.split(/,|\s/)
                                : [];

                            curLineValue = !vc2_util.isEmpty(curLineValue)
                                ? curLineValue.split(/,|\s/)
                                : [];

                            // Ensure fldValue is an array, splitting by comma or whitespace if necessary
                            // Fixed: Use vclib_util type check instead of global util
                            fldValue =
                                (ns_util.isArray(fldValue) ? fldValue : fldValue.split(/,|\s/)) ||
                                [];

                            // If serials, slice to match quantity
                            if (
                                vendorCol == 'SERIAL_NUMS' &&
                                option.quantity &&
                                option.quantity < fldValue.length
                            ) {
                                fldValue = fldValue.splice(option.runningQty, option.quantity);
                            }
                            // Combine and remove duplicates from the existing and new field values
                            fldValue = vc2_util.uniqueArray(poFldValue.concat(fldValue));
                            fldValue = fldValue.join(' ');
                        } else if (vc2_util.inArray(orderCol, FIELD_DEF.TEXTAREA)) {
                            // Fixed: Use vclib_util type check instead of global util
                            fldValue = ns_util.isArray(fldValue) ? fldValue.join(' ') : fldValue;
                        }

                        lineData[orderCol] = fldValue;
                    });
                });

                returnValue = lineData;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },

        /**
         * Retrieves the shipping group from a Sales Order for a given PO.
         * @param {Object} option - Options object
         * @param {string} [option.poId] - Purchase Order ID
         * @param {Record} [option.poRec] - Purchase Order record
         * @param {string} [option.soId] - Sales Order ID
         * @param {Record} [option.soRec] - Sales Order record
         * @returns {string|boolean} Ship group ID or false if not found/error
         */
        getShipGroup: function (option) {
            var logTitle = [LogTitle, 'Helper:getShipGroup'].join('|'),
                returnValue;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                // Check if MULTISHIPTO feature is enabled
                if (!ns_runtime.isFeatureInEffect({ feature: 'MULTISHIPTO' })) {
                    throw { code: 'FEATURE_NOT_ENABLED', details: 'MULTISHIPTO' };
                }

                var poId = option.poId || (option.poRec ? option.poRec.id : null);
                if (!poId) throw { code: 'MISSING_PARAMETER', details: 'poId or poRec' };

                var soRec = option.soRec;
                if (!soRec) {
                    var soId = option.soId;
                    if (!soId) throw { code: 'MISSING_PARAMETER', details: 'soId' };

                    soRec = vcs_recordlib.load({ type: ns_record.Type.SALES_ORDER, id: soId });
                    if (!soRec) throw { code: 'LOAD_ERROR', details: 'soId: ' + soId };
                }

                // Find line with matching PO and get its ship group
                var soLineNo = soRec.findSublistLineWithValue({
                    sublistId: 'item',
                    fieldId: 'createdpo',
                    value: poId
                });

                if (soLineNo >= 0) {
                    returnValue = soRec.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'shipgroup',
                        line: soLineNo
                    });
                }
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Retrieves inventory locations for cross-subsidiary fulfillment from a Sales Order.
         * @param {Object} option - Options object
         * @param {string} [option.poId] - Purchase Order ID
         * @param {Record} [option.poRec] - Purchase Order record
         * @param {string} [option.soId] - Sales Order ID
         * @param {Record} [option.soRec] - Sales Order record
         * @returns {Array|string|boolean} Array of inventory location IDs, or false on error
         */
        getInventoryLocations: function (option) {
            var logTitle = [LogTitle, 'Helper:getInventoryLocations'].join('|'),
                returnValue;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                // check if the feature is enabled
                if (!ns_runtime.isFeatureInEffect({ feature: 'crosssubsidiaryfulfillment' })) {
                    throw {
                        code: 'FEATURE_NOT_ENABLED',
                        details: 'CROSSSUBSIDIARYFULFILLMENT'
                    };
                }

                var poRec = option.poRec,
                    poId = option.poId,
                    soRec = option.soRec,
                    soId = option.soId;

                if (!poId) {
                    if (!poRec) throw { code: 'MISSING_PARAMETER', details: 'poRec' };
                    poId = poRec.id;
                }

                if (!soRec) {
                    if (!soId) throw { code: 'MISSING_PARAMETER', details: 'soId' };
                    soRec = vcs_recordlib.load({ type: ns_record.Type.SALES_ORDER, id: soId });

                    if (!soRec) throw { code: 'LOAD_ERROR', details: 'soId: ' + soId };
                }

                var soLineCount = soRec.getLineCount({ sublistId: 'item' }),
                    inventoryLocations = [];

                for (var soLine = 0; soLine < soLineCount; soLine++) {
                    var lineValues = vcs_recordlib.extractLineValues({
                        record: soRec,
                        line: soLine,
                        additionalColumns: ['createdpo', 'createpo', 'inventorylocation']
                    });
                    vc2_util.log(logTitle, '... lineValues: ', lineValues);

                    if (lineValues.createdpo !== poId) continue;
                    if (vc2_util.isEmpty(lineValues.inventorylocation)) continue;

                    if (!vc2_util.inArray(lineValues.inventorylocation, inventoryLocations))
                        inventoryLocations.push(lineValues.inventorylocation);
                }

                returnValue = inventoryLocations;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            } finally {
                vc2_util.log(logTitle, '... inventoryLocations: ', returnValue);
            }

            return returnValue;
        },

        // Set same location for all lines in a transaction
        getLineLocation: function (option) {
            var logTitle = [LogTitle, 'Helper:setSameLineLocation'].join('|'),
                returnValue;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                // check if the feature is enabled
                if (!ns_runtime.isFeatureInEffect({ feature: 'MULTILOCINVT' })) {
                    throw {
                        code: 'FEATURE_NOT_ENABLED',
                        details: 'MULTILOCINVT'
                    };
                }

                var record = option.record,
                    soLocation = option.location,
                    arrLineLocation = [];

                // get the location
                var lineCount = record.getLineCount({ sublistId: 'item' });
                for (var line = 0; line < lineCount; line++) {
                    var lineValues = vcs_recordlib.extractLineValues({
                        record: record,
                        line: line,
                        additionalColumns: ['location']
                    });

                    if (
                        !vc2_util.isEmpty(lineValues.location) &&
                        !vc2_util.inArray(lineValues.location, arrLineLocation)
                    ) {
                        arrLineLocation.push(lineValues.location);
                    }
                }

                var defaultLocation = soLocation;
                if (!vc2_util.isEmpty(arrLineLocation) && arrLineLocation.length == 1) {
                    defaultLocation = arrLineLocation[0];
                }

                returnValue = defaultLocation;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        // Add inventory details including serial numbers to transaction line
        addInventoryDetails: function (option) {
            var logTitle = [LogTitle, 'Helper:addInventoryDetails'].join('|'),
                returnValue = {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                var record = option.record,
                    lineNo = option.line,
                    lineData = option.lineData,
                    serialNumbers = option.serials || option.serialNumbers || [];

                // lineNo, records and serialNUmbes are required
                if (!record) throw { code: 'MISSING_PARAMETER', details: 'record' };
                if (vc2_util.isEmpty(serialNumbers))
                    throw { code: 'MISSING_PARAMETER', details: 'serialNumbers' };

                if (!lineData) {
                    lineData = vcs_recordlib.extractLineValues({
                        record: record,
                        line: lineNo,
                        additionalColumns: ORDERLINE_COLS.concat([
                            'orderline',
                            'itemname',
                            'lineuniquekey',
                            'location',
                            'inventorydetailreq',
                            'inventorydetailavail',
                            'inventorydetailset',
                            'poline',
                            'binitem',
                            'isserial'
                        ])
                    });
                }

                if (
                    !vc2_util.inArray(lineData.isserial, ['T', 't']) &&
                    !vc2_util.inArray(lineData.inventorydetailavail, ['T', 't']) &&
                    !vc2_util.inArray(lineData.inventorydetailavail, ['T', 't'])
                ) {
                    throw {
                        code: 'SERIALS_NOT_REQUIRED',
                        detail: JSON.stringify(
                            vc2_util.extractValues({
                                source: lineData,
                                fields: [
                                    'itemname',
                                    'item',
                                    'inventorydetailreq',
                                    'inventorydetailavail',
                                    'inventorydetailset'
                                ]
                            })
                        )
                    };
                }
                /// VALIDATE THE SERIAL NUMBERS //
                // Fixed: Use vclib_util type check instead of global util
                serialNumbers = ns_util.isArray(serialNumbers)
                    ? serialNumbers
                    : serialNumbers.split(/,|\s/);

                if (vc2_util.isEmpty(serialNumbers))
                    throw { code: 'MISSING_PARAMETER', details: 'serialNumbers' };

                var validSerials = [];
                serialNumbers.forEach(function (serial) {
                    if (!vc2_util.isEmpty(serial) && serial != 'NA') validSerials.push(serial);
                });

                if (vc2_util.isEmpty(validSerials)) throw 'No valid serial numbers found';

                vc2_util.log(logTitle, '.... set serial nos ', validSerials);

                // ADD THE SERIAL NUMBERS TO THE LINE //
                record.selectLine({ sublistId: 'item', line: lineNo });
                var invDetailSubrec = record.getCurrentSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail'
                });

                validSerials.forEach(function (serial) {
                    invDetailSubrec.selectNewLine({ sublistId: 'inventoryassignment' });
                    invDetailSubrec.setCurrentSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'receiptinventorynumber',
                        value: serial
                    });
                    invDetailSubrec.commitLine({ sublistId: 'inventoryassignment' });
                });
                record.commitLine({ sublistId: 'item' });

                returnValue = true;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        addNativePackages: function (option) {
            var logTitle = [LogTitle, 'Helper:addNativePackages'].join('|'),
                returnValue = {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                var record = option.record,
                    packages = option.packages || [];

                // validate the packages
                // Fixed: Use vclib_util type check instead of global util
                packages = ns_util.isArray(packages) ? packages : packages.split(/,|\s/);

                if (vc2_util.isEmpty(packages))
                    throw { code: 'MISSING_PARAMETER', details: 'packages' };

                // VALIDATE THE PACKAGES //
                var validPackages = [];
                packages.forEach(function (package) {
                    if (!vc2_util.isEmpty(package) && package != 'NA') validPackages.push(package);
                });

                if (vc2_util.isEmpty(validPackages))
                    throw { code: 'VALIDATION_ERROR', details: 'No valid packages found' };

                vc2_util.log(logTitle, '.... set packages ', validPackages);

                var ctr = 0;
                validPackages.forEach(function (package) {
                    try {
                        if (!ctr) record.selectLine({ sublistId: 'package', line: ctr });
                        else record.selectNewLine({ sublistId: 'package' });

                        record.setCurrentSublistValue({
                            sublistId: 'package',
                            fieldId: 'packageweight',
                            value: 1.0
                        });
                        record.setCurrentSublistValue({
                            sublistId: 'package',
                            fieldId: 'packagetrackingnumber',
                            value: package
                        });

                        record.commitLine({ sublistId: 'package' });
                        ctr++;
                    } catch (package_error) {
                        vclib_error.logWarn(logTitle, package_error, ERROR_LIST);
                    }
                });

                returnValue = true;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Sets header field values on a transaction record (fulfillment, receipt, etc.).
         * @param {Object} option - Options object
         * @param {Record} option.record - NetSuite record instance
         * @param {Object} option.headerValues - Object containing field IDs and values to set
         * @returns {boolean} True if successful, false otherwise
         */
        setHeaderValues: function (option) {
            var logTitle = [LogTitle, 'setHeaderValues'].join('::'),
                returnValue = {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                var record = option.record,
                    headerValues = option.headerValues || {};

                if (!record) throw { code: 'MISSING_PARAMETER', details: 'record' };
                if (vc2_util.isEmpty(headerValues))
                    throw { code: 'MISSING_PARAMETER', details: 'headerValues' };

                // do some validations
                if (vc2_constant.GLOBAL.PICK_PACK_SHIP) {
                    headerValues.shipstatus = 'C'; // set the shipped status

                    var shippedDate = headerValues.shippeddate || headerValues.trandate;
                    headerValues.shippeddate = shippedDate;
                }

                var headerCols = [];
                // prioritize these fields
                ['shippeddate', 'shipstatus', 'trandate'].forEach(function (fld) {
                    if (headerValues[fld]) headerCols.push(fld);
                });

                // add the rest of the fields
                for (var fld in headerValues) {
                    if (vc2_util.inArray(fld, headerCols)) continue;
                    headerCols.push(fld);
                }
                vc2_util.log(logTitle, '-- Header Values: ', headerValues);

                // if trandate is present, try to get the current posting period
                var currentPostingPeriod = vc2_util.inArray('trandate', headerCols)
                    ? record.getValue({ fieldId: 'postingperiod' })
                    : null;

                /// set all the fields
                headerCols.forEach(function (fld) {
                    var headerValue = headerValues[fld];
                    record.setValue({ fieldId: fld, value: headerValue });
                });

                // check if the current posting period is alreayd closed
                if (Helper.isPeriodLocked({ record: record })) {
                    record.setValue({ fieldId: 'postingperiod', value: currentPostingPeriod });
                }

                returnValue = true;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Validates that a Sales Order is fulfillable for Item Fulfillment creation.
         * @param {Object} option - Options object
         * @param {string|number} [option.poId] - Purchase Order ID
         * @param {Record} [option.poRec] - Purchase Order record
         * @param {string|number} [option.soId] - Sales Order ID
         * @param {Record} [option.soRec] - Sales Order record
         * @returns {boolean} True if record is fulfillable
         * @throws {Object} Error object if Sales Order is not fulfillable
         */
        validateFFRecord: function (option) {
            var logTitle = [LogTitle, 'validateFFRecord'].join('::'),
                returnValue;

            var poId = option.poId,
                poRec = option.poRec,
                soId = option.soId,
                soRec = option.soRec;

            // Attempt to get Sales Order ID from the available sources
            if (soRec) {
                soId = soRec.id;
            } else if (poRec) {
                // Extract Sales Order ID from PO's 'createdfrom' field
                soId = poRec.getValue({ fieldId: 'createdfrom' });
            } else if (poId) {
                // Look up Sales Order ID from Purchase Order
                var poData = vc2_util.flatLookup({
                    type: ns_record.Type.PURCHASE_ORDER,
                    id: poId,
                    columns: ['createdfrom']
                });
                soId = poData.createdfrom.value || poData.createdfrom;
            }

            // Error if no Sales Order ID found
            if (!soId) {
                throw { code: 'MISSING_PARAMETER', details: 'soId or poId' };
            }

            // Load Sales Order record if not provided
            if (!soRec) {
                soRec = vcs_recordlib.load({
                    type: ns_record.Type.SALES_ORDER,
                    id: soId
                });
            }

            var salesOrderData = vcs_recordlib.extractValues({
                record: soRec,
                columns: ['status', 'statusRef', 'trandate', 'postingperiod', 'location']
            });

            // Check if SO status allows fulfillment
            if (
                !vc2_util.inArray(salesOrderData.statusRef, [
                    'pendingFulfillment',
                    'pendingApproval',
                    'partiallyFulfilled',
                    'pendingBillingPartFulfilled'
                ])
            ) {
                throw {
                    code: 'NOT_FULFILLABLE',
                    message: 'Sales Order is not fulfillable',
                    details: [salesOrderData.statusRef, salesOrderData.status].join(' / '),
                    level: vclib_error.ErrorLevel.WARNING
                };
            }

            return true;
        },

        /**
         * Validates that a Purchase Order is receivable for Item Receipt creation.
         * @param {Object} option - Options object
         * @param {string|number} [option.poId] - Purchase Order ID
         * @param {Record} [option.poRec] - Purchase Order record
         * @returns {boolean} True if record is receivable
         * @throws {Object} Error object if Purchase Order is not receivable
         */
        validateIRRecord: function (option) {
            var logTitle = [LogTitle, 'validateIRRecord'].join('::'),
                returnValue;

            var poId = option.poId,
                poRec = option.poRec;

            // Attempt to get Purchase Order ID or record from available sources
            if (poRec) {
                poId = poRec.id;
            } else if (poId) {
                // Load Purchase Order if ID is provided
                poRec = vcs_recordlib.load({
                    type: ns_record.Type.PURCHASE_ORDER,
                    id: poId
                });
            }
            if (!poId) {
                throw { code: 'MISSING_PARAMETER', details: 'poId or poRec' };
            }

            var orderData = vcs_recordlib.extractValues({
                record: poRec,
                columns: ['status', 'statusRef', 'trandate', 'postingperiod', 'location']
            });

            // Check if PO status allows receipt
            if (
                !vc2_util.inArray(orderData.statusRef, [
                    'pendingReceipt',
                    'pendingBillPartReceived',
                    'partiallyReceived',
                    'pendingApproval'
                ])
            ) {
                throw {
                    code: 'NOT_FULFILLABLE',
                    message: 'Purchase Order is not receivable',
                    details: [orderData.statusRef, orderData.status].join(' / ')
                };
            }

            return true;
        },

        /**
         * Checks if an item has already been fulfilled on a given Sales Order.
         * @param {string|number} itemId - Item internal ID
         * @param {string|number} soId - Sales Order internal ID
         * @returns {boolean} True if item is fulfilled, false otherwise
         */
        isItemFulfilled: function (itemId, soId) {
            if (!itemId || !soId) return false;
            var objIfSearch = ns_search.create({
                type: 'itemfulfillment',
                filters: [
                    ['type', 'anyof', 'ItemShip'],
                    'AND',
                    ['item', 'anyof', itemId],
                    'AND',
                    ['createdfrom', 'anyof', soId]
                ],
                columns: ['internalid', 'statusref']
            });
            var searchCount = objIfSearch.runPaged().count;
            if (searchCount >= 1) {
                return true;
            }
            return false;
        },

        /**
         * Automatically marks items in a record (fulfillment or receipt) as received/fulfilled.
         * Dependencies: Helper.isEmpty, Helper.forceFloat utility methods.
         * @param {Record} objRec - NetSuite record (Item Fulfillment or Item Receipt)
         * @param {Array<Object>} arrValues - Array of line values with item internal IDs
         * @param {string|number} stPoId - Purchase Order ID for logging
         */
        autoFulfillSetItem: function (objRec, arrValues, stPoId) {
            var stSublistId = 'item';
            var arrItemsZeroAmount = [];
            var arrInvalidItems = [];

            // Iterate through all item lines in the record
            for (var i = 0; i < objRec.getLineCount(stSublistId); i++) {
                objRec.selectLine({
                    sublistId: stSublistId,
                    line: i
                });
                var itemId = objRec.getCurrentSublistValue({
                    sublistId: stSublistId,
                    fieldId: 'item'
                });
                var itemName = objRec.getCurrentSublistText({
                    sublistId: stSublistId,
                    fieldId: 'item'
                });
                var lineAmt = objRec.getCurrentSublistValue({
                    sublistId: stSublistId,
                    fieldId: 'amount'
                });
                var lineFxAmt = objRec.getCurrentSublistValue({
                    sublistId: stSublistId,
                    fieldId: 'itemfxamount'
                });

                // Search for matching item in the provided values array
                var arrItem = arrValues.filter(function (objData) {
                    return objData.item.value === itemId;
                });

                // Mark item as receivable if found in array, otherwise skip
                if (arrItem.length <= 0 || Helper.isEmpty(arrItem)) {
                    arrInvalidItems.push(itemName);
                    objRec.setCurrentSublistValue({
                        sublistId: stSublistId,
                        fieldId: 'itemreceive',
                        value: false
                    });
                } else {
                    arrItemsZeroAmount.push(itemName);
                    objRec.setCurrentSublistValue({
                        sublistId: stSublistId,
                        fieldId: 'itemreceive',
                        value: true
                    });
                }

                // Skip items with non-zero amounts (only fulfill zero-amount items)
                if (Helper.forceFloat(lineAmt) > 0 || Helper.forceFloat(lineFxAmt) > 0) {
                    arrInvalidItems.push(itemName);
                    objRec.setCurrentSublistValue({
                        sublistId: stSublistId,
                        fieldId: 'itemreceive',
                        value: false
                    });
                }
                objRec.commitLine({
                    sublistId: stSublistId
                });
            }
        },

        /**
         * Checks if a vendor line is missing required field values.
         * @param {Object} lineData - Vendor line data object
         * @param {Array<string>} fieldsToCheck - Field names to validate for presence and non-empty values
         * @returns {boolean} True if any required field is missing or empty, false otherwise
         */
        isVendorLineMissingValues: function (lineData, fieldsToCheck) {
            var returnValue = false;
            if (lineData && fieldsToCheck && fieldsToCheck.length) {
                // Validate each required field
                for (var i = 0, len = fieldsToCheck.length; i < len; i += 1) {
                    var fieldName = fieldsToCheck[i];
                    // Return true if field doesn't exist, is empty, or has 'NA' value
                    if (
                        !lineData.hasOwnProperty(fieldName) ||
                        vc2_util.isEmpty(lineData[fieldName]) ||
                        lineData[fieldName] == 'NA'
                    ) {
                        returnValue = true;
                        break;
                    }
                }
            }
            return returnValue;
        }
    };

    // Fixed: Named library object export (TransactionLib) per VAR Connect standards
    var TransactionLib = {
        /**
         * Searches for transactions of a given type with specified filters and columns.
         * @param {Object} option - Options object
         * @param {string} option.type - NetSuite record type (e.g., 'salesorder', 'itemfulfillment')
         * @param {Array} option.filters - Array of search filters
         * @param {Array} option.columns - Array of search columns
         * @returns {Array<Object>} Array of search result objects
         */
        searchTransaction: function (option) {
            var logTitle = [LogTitle, 'searchTransaction'].join('::'),
                returnValue = [];

            option = option || {};

            try {
                if (!option.type)
                    throw { code: 'MISSING_TYPE', message: 'Transaction type is required' };
                var searchObj = ns_search.create({
                    type: option.type,
                    filters: option.filters || [],
                    columns: option.columns || ['internalid']
                });
                var pagedData = searchObj.runPaged();
                pagedData.pageRanges.forEach(function (pageRange) {
                    var page = pagedData.fetch({ index: pageRange.index });
                    page.data.forEach(function (result) {
                        var obj = {};
                        (option.columns || ['internalid']).forEach(function (col) {
                            var colId = typeof col === 'string' ? col : col.name || col;
                            obj[colId] = result.getValue({ name: colId });
                        });
                        returnValue.push(obj);
                    });
                });
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
            }
            return returnValue;
        },

        /**
         * Retrieves existing fulfillments for given PO/SO and order numbers.
         * @param {Object} option - Options object
         * @param {string|number} [option.poId] - Purchase Order ID
         * @param {string|number} [option.soId] - Sales Order ID
         * @param {string} [option.recordType] - Record type (default: 'itemfulfillment')
         * @param {Array<string>} [option.vendorOrderNums] - Vendor order numbers
         * @param {Array<string>} [option.orderNums] - Order numbers
         * @returns {Object|boolean} Fulfillment results or false on error
         */
        getExistingFulfillments: function (option) {
            var logTitle = [LogTitle, 'getExistingFulfillments'].join('|'),
                returnValue;
            option = option || {};

            try {
                vc2_util.log(logTitle, '#### START: getExistingFulfillments #####', option);

                var poId = option.poId || (option.poRec ? option.poRec.id : null),
                    soId = option.soId || (option.soRec ? option.soRec.id : null),
                    recordType = option.recordType || 'itemfulfillment';

                orderNums = option.vendorOrderNums || option.orderNums;

                if (vc2_util.isEmpty(orderNums)) return false;

                var searchOption = {
                    type: recordType,
                    filters: [['recordtype', 'is', recordType], 'AND', ['mainline', 'is', 'T']],
                    columns: [
                        'mainline',
                        'internalid',
                        'trandate',
                        'tranid',
                        'entity',
                        'custbody_ctc_if_vendor_order_match'
                    ]
                };

                var orderNumFilter = [];
                orderNums.forEach(function (orderNum, cnt) {
                    orderNumFilter.push([
                        'custbody_ctc_if_vendor_order_match',
                        ns_search.Operator.IS,
                        orderNum
                    ]);
                    if (cnt < orderNums.length - 1) orderNumFilter.push('OR');
                    return true;
                });

                // push the orderNumFilter to the main search filters
                searchOption.filters.push('AND');
                searchOption.filters.push(orderNumFilter);

                // fetch all the results
                var arrResults = {};

                vc2_util.log(logTitle, '... searchOption: ', searchOption);

                var searchResults = vc2_util.searchAllPaged({
                    searchObj: ns_search.create(searchOption)
                });

                searchResults.forEach(function (result) {
                    var orderNum = result.getValue({ name: 'custbody_ctc_if_vendor_order_match' });
                    arrResults[orderNum] = {
                        id: result.id,
                        tranid: result.getValue({ name: 'tranid' })
                    };
                    return true;
                });

                returnValue = arrResults;
            } catch (error) {
                var errorObj = vclib_error.warn(logTitle, error);
                vc2_util.vcLog({
                    title: 'Fulfillment |  Existing Orders Error',
                    error: errorObj.errorMessage,
                    recordId: Current.PO_ID
                });

                returnValue = false;
                throw errorObj.errorMessage;
            } finally {
                // log.audit(logTitle, logPrefix + '>> returnValue: ' + JSON.stringify(returnValue));
            }

            return returnValue;
        },

        /**
         * Validates if PO lines can be fulfilled based on vendor data.
         * @param {Object} option - Options object
         * @param {string|number} option.poId - Purchase Order ID
         * @param {Object} option.poRec - Purchase Order record
         * @param {string|number} option.soId - Sales Order ID
         * @param {Object} option.soRec - Sales Order record
         * @param {string} [option.forRecordType] - Record type
         * @param {Array<Object>} option.vendorLines - Vendor line data
         * @param {Array<Object>} [option.orderLines] - Order line data
         * @param {Object} [option.mainConfig] - Main config
         * @param {Object} [option.vendorConfig] - Vendor config
         * @returns {Object} Validation result
         */
        validateForFulfillment: function (option) {
            var logTitle = [LogTitle, 'validateForFulfillment'].join('::'),
                returnValue = {
                    success: true,
                    hasError: false
                };

            var errorList = [];

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                var poId = option.poId,
                    poRec = option.poRec,
                    soId = option.soId,
                    soRec = option.soRec,
                    forRecordType = option.forRecordType || ns_record.Type.ITEM_FULFILLMENT,
                    orderNum = option.orderNum;

                var mainConfig = option.mainConfig || vcs_configlib.mainConfig(),
                    vendorConfig =
                        option.vendorConfig || vcs_configlib.orderVendorConfig({ poId: poId });

                // check if the items are fulfillable
                var vendorLines = option.vendorLines,
                    poLines =
                        option.orderLines ||
                        vcs_recordlib.extractLineValues({
                            record: poRec,
                            additionalColumns: vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS
                        });

                if (vc2_util.isEmpty(vendorLines))
                    throw { code: 'MISSING_PARAMETER', details: 'vendorLines' };

                if (forRecordType == ns_record.Type.ITEM_FULFILLMENT) {
                    Helper.validateFFRecord(option);
                } else if (forRecordType == ns_record.Type.ITEM_RECEIPT) {
                    Helper.validateIRRecord(option);
                }

                /// VALIDATE if all of the items are Shipped ///
                var allShipped = true;

                vendorLines.forEach(function (vendorLine) {
                    try {
                        if (!vendorLine.IS_SHIPPED) {
                            allShipped = false;
                            throw vendorLine.NOTSHIPPED;
                        }
                    } catch (ship_error) {
                        var shipErrorObj = vclib_error.interpret(ship_error, ERROR_LIST),
                            errorMsg = shipErrorObj.message || vendorLine.NOTSHIPPED;
                        errorList.push(errorMsg);
                    }
                });

                ns_util.extend(returnValue, {
                    hasUnshipped: !allShipped
                });

                if (!allShipped) throw 'HAS_UNSHIPPED_ITEMS';

                var hasFulfillable = false,
                    hasUnfulfillable = false,
                    cantBeFulfilled = false, // used to described item.canBeFulfilled
                    cantBeFulfilledList = [];

                vcs_itemmatch.matchOrderLines({
                    poRec: poRec,
                    soRec: soRec,
                    poId: poId,
                    vendorLines: vendorLines,
                    poLines: (function () {
                        poLines.forEach(function (orderLine) {
                            var quantity = isNaN(orderLine.quantity) ? 0 : orderLine.quantity;
                            var quantityReceived = isNaN(orderLine.quantityreceived)
                                ? 0
                                : orderLine.quantityreceived;
                            orderLine.AVAILQTY = quantity - quantityReceived;
                        });
                        return poLines; // corrected the return value
                    })(),
                    vendorConfig: option.vendorConfig,
                    mainConfig: option.mainConfig
                });

                vendorLines.forEach(function (vendorLine) {
                    try {
                        if (!vendorLine.HAS_MATCH) throw 'MATCH_NOT_FOUND'; // no matching line found
                        if (vc2_util.isEmpty(vendorLine.MATCHING)) throw 'LINE_FULFILLED';

                        var availableQty = 0; // start with the current required quantity

                        var isFulfillable = true;
                        vendorLine.MATCHING.forEach(function (matchedLine) {
                            availableQty += matchedLine.quantity; // add to the available quantity

                            if (
                                !vc2_util.isEmpty(matchedLine.fulfillable) &&
                                !matchedLine.fulfillable
                            ) {
                                isFulfillable = false; // set isFulfillable to false if not fulfillable
                                cantBeFulfilled = true;
                                cantBeFulfilledList.push(matchedLine.item_text); // corrected the push method
                                return;
                            }

                            if (!vc2_util.isEmpty(matchedLine.quantityreceived)) {
                                // if any quantities already received, reduce the available quantity
                                availableQty -= matchedLine.quantityreceived; // reduce available quantity
                            }
                        });

                        if (!isFulfillable) throw 'UNFULFILLABLE_ITEM';
                        if (!availableQty) throw 'FULLY_RECEIVED';
                        if (availableQty < vendorLine.QUANTITY) throw 'INSUFFICIENT_QTY';

                        hasFulfillable = true; // there are items that can be fulfilled
                    } catch (line_error) {
                        // there's an error with this line
                        hasUnfulfillable = true; // set hasUnfulfillable to true

                        var errorMsg = vclib_error.interpret(line_error, ERROR_LIST);
                        errorList.push(errorMsg.message);
                    }
                    return true;
                });

                ns_util.extend(returnValue, {
                    hasFulfillable: hasFulfillable,
                    hasUnfulfillable: cantBeFulfilled || hasUnfulfillable
                });

                if (cantBeFulfilled && !mainConfig.allowNonFFItems)
                    throw { code: 'UNFULFILLABLE_LINES', details: cantBeFulfilledList };

                if (!hasFulfillable) throw 'NO_FULFILLABLE_LINES'; // ensuring fulfillable lines exist
                if (hasUnfulfillable) throw 'UNFULFILLABLE_ITEM';
            } catch (error) {
                var errorObj = vclib_error.warn(logTitle, error, ERROR_LIST),
                    errorMsg = errorObj.detail
                        ? [errorObj.message, errorObj.detail].join(' - ')
                        : errorObj.message;

                if (errorList && errorList.length) {
                    // If there are existing error messages, append the new error message
                    errorList = vc2_util.uniqueArray(errorList);
                    errorMsg += ': ' + errorList.join(', ');
                }

                ns_util.extend(returnValue, {
                    errorCode: errorObj.code || 'VALIDATION_ERROR',
                    code: errorObj.code || 'VALIDATION_ERROR',
                    errorMessage: errorMsg,
                    hasError: true
                });
            }

            return returnValue;
        },

        /**
         * Updates a purchase order with vendor line and header values.
         * @param {Object} option - Options object
         * @param {string|number} option.poId - Purchase Order ID
         * @param {Object} option.poRec - Purchase Order record
         * @param {boolean} [option.isDropShip] - Is dropship
         * @param {Object} [option.headerValues] - Header field values
         * @param {Array<Object>} [option.vendorLines] - Vendor line data
         * @param {Object} [option.mainConfig] - Main config
         * @param {Object} [option.vendorConfig] - Vendor config
         * @returns {Object} Update result
         */
        updatePurchaseOrder: function (option) {
            var logTitle = [LogTitle, 'updatePurchaseOrder'].join('::'),
                returnValue = {};

            var VENDOR_COLS = vc2_constant.VENDOR_LINE_DEF.VENDORLINE_COLS,
                ORDERLINE_COLS = vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS,
                FIELD_DEF = vc2_constant.VENDOR_LINE_DEF.FIELD_DEF,
                MAPPING = vc2_constant.VENDOR_LINE_DEF.MAPPING;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                vc2_util.log(logTitle, '#### START: UPDATE PURCHASE ORDER #####', option);

                var poId = option.poId,
                    poRec = option.poRec || (poId
                        ? vcs_recordlib.load({ type: 'purchaseorder', id: poId, isDynamic: true })
                        : null),
                    isDropShip = option.isDropShip,
                    headerValues = option.headerValues || {};

                returnValue.poId = poId;

                var mainConfig = option.mainConfig || vcs_configlib.mainConfig(),
                    vendorConfig =
                        option.vendorConfig || vcs_configlib.orderVendorConfig({ poId: poId });

                /// PREPARE THE LINE ITEMS /////////////////////////
                var vendorLines = option.vendorLines || [],
                    poLines = vcs_recordlib.extractLineValues({
                        record: poRec,
                        additionalColumns: vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS
                    });

                /// SET HEADER FIELDS //////////////////////////////
                /// check that ALL vendor lines are complete
                for (var i = 0, len = vendorLines.length; i < len; i += 1) {
                    var vendorLine = vendorLines[i];
                    // re-run order status on fulfilled subscription items until start and end dates are complete
                    if (
                        vc2_util.inArray(poRec.getValue({ fieldId: 'statusRef' }), [
                            'pendingBilling'
                        ]) &&
                        !Helper.isVendorLineMissingValues(vendorLine, ['subscription_id']) &&
                        Helper.isVendorLineMissingValues(vendorLine, ['start_date', 'end_date'])
                    ) {
                        headerValues[vc2_constant.FIELD.TRANSACTION.FORCE_RUN_ORDER_STATUS] = true;
                        break;
                    }
                }

                /// match the lines
                vendorLines = vcs_itemmatch.matchVendorLines({
                    poRec: poRec,
                    poId: poId,
                    vendorLines: vendorLines,
                    poLines: (function () {
                        poLines.forEach(function (orderLine) {
                            orderLine.AVAILQTY = orderLine.quantity;
                        });
                        return poLines; // corrected the return value
                    })(),
                    vendorConfig: vendorConfig,
                    mainConfig: mainConfig
                });

                // run thru each vendor line
                var arrPOVendorLines = [];

                vendorLines.forEach(function (vendorLine) {
                    if (vc2_util.isEmpty(vendorLine.MATCHING)) return false;
                    var appliedQty = vendorLine.APPLIEDQTY || 0;

                    vendorLine.MATCHING.forEach(function (matchedPOLine) {
                        // applied quantity to this matched fulfillment line
                        var itemqty =
                            matchedPOLine.quantity > appliedQty
                                ? appliedQty
                                : matchedPOLine.quantity;
                        appliedQty -= itemqty;

                        // Fixed: Use vc2_util.extend instead of global util.extend
                        var poLine = vc2_util.extend(
                            {
                                quantity: itemqty,
                                VENDORLINE: vc2_util.extractValues({
                                    source: vendorLine,
                                    fields: VENDOR_COLS
                                })
                            },
                            matchedPOLine
                        );
                        arrPOVendorLines.push(poLine);

                        return true;
                    });

                    return true;
                });

                vc2_util.log(logTitle, '.... arrPOLines: ', arrPOVendorLines);

                if (vc2_util.isEmpty(arrPOVendorLines)) {
                    if (vc2_util.isEmpty(headerValues)) {
                        throw 'No valid lines found';
                    } else {
                        vc2_util.log(logTitle, '.... no valid lines found but updating headers');
                        if (option.doSave) {
                            vc2_util.log(logTitle, '.... submitting the record', poRec.id);
                            returnValue.id = poId;
                            vcs_recordlib.updateRecord({
                                type: poRec.type,
                                id: poRec.id,
                                data: headerValues
                            });
                        }
                    }
                } else {
                    returnValue.id = poId;
                    returnValue.Lines = arrPOVendorLines;

                    var lineCount = poRec.getLineCount({ sublistId: 'item' }),
                        runningQty = 0;

                    for (var line = 0; line < lineCount; line++) {
                        var currentLine = vcs_recordlib.extractLineValues({
                            record: poRec,
                            sublistId: 'item',
                            line: line,
                            additionalColumns: ORDERLINE_COLS.concat([
                                'orderline',
                                'itemname',
                                'lineuniquekey',
                                'location',
                                'inventorydetailreq',
                                'inventorydetailavail',
                                'inventorydetailset',
                                'poline',
                                'binitem',
                                'isserial'
                            ])
                        });

                        var matchedPOVendorLines = arrPOVendorLines.filter(function (lineData) {
                            return lineData.line == currentLine.line;
                        });

                        if (vc2_util.isEmpty(matchedPOVendorLines)) {
                            vc2_util.log(logTitle, '.... skipping line: ', [line, currentLine]);
                            continue;
                        }

                        var poLineValues = {},
                            updateLineValues = {},
                            isSpecialOrder =
                                !vc2_util.isEmpty(option.isDropShip) && !option.isDropShip;

                        // flatten the po Vendor lines
                        matchedPOVendorLines.forEach(function (lineData) {
                            var lineValue = Helper.setVendorLineValues({
                                currentLine: currentLine,
                                vendorLine: lineData.VENDORLINE,
                                poLineValue: poLineValues,
                                quantity: lineData.quantity,
                                runningQty: runningQty
                            });

                            runningQty += lineData.quantity;

                            if (!mainConfig.useInboundTrackingNumbers || !isSpecialOrder) {
                                lineValue[vc2_constant.FIELD.TRANSACTION.INBOUND_TRACKING_NUM] =
                                    null;
                            }

                            for (var fld in lineValue) {
                                if (vc2_util.isEmpty(lineValue[fld])) continue;
                                poLineValues[fld] = lineValue[fld];
                            }
                        });

                        // // check if the line repeats
                        vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS.forEach(function (fld) {
                            if (currentLine[fld] !== poLineValues[fld]) {
                                updateLineValues[fld] = poLineValues[fld];
                            }
                        });

                        // vc2_util.log(logTitle, '........ updateLineValues: ', {
                        //     current: currentLine,
                        //     lineValues: poLineValues,
                        //     update: updateLineValues
                        // });

                        vcs_recordlib.updateLineValues({
                            record: poRec,
                            line: line,
                            lineValues: updateLineValues
                        });
                    }

                    if (!vc2_util.isEmpty(headerValues)) {
                        for (var fld in headerValues) {
                            poRec.setValue({ fieldId: fld, value: headerValues[fld] });
                        }
                    }

                    if (option.doSave) {
                        vc2_util.log(logTitle, '... saving the record: ', poRec.id);
                        returnValue.id = poRec.save({
                            enableSourcing: true,
                            ignoreMandatoryFields: true
                        });
                        returnValue.vendorLines = vendorLines;
                    }
                }

                vc2_util.vcLog({
                    title: 'Update PO Record | Success',
                    recordId: returnValue.poId,
                    message: 'Purchase Order updated successfully',
                    status: LOG_STATUS.INFO
                });
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error, ERROR_LIST);
                // Fixed: Use vc2_util.extend instead of global util.extend
                ns_util.extend(returnValue, {
                    errorMessage: errorObj.errorMessage,
                    hasError: true,
                    success: false // indicate the fulfillment failed
                });

                vc2_util.vcLog({
                    title: 'Update PO Record | Error',
                    recordId: returnValue.poId,
                    message: returnValue.errorMessage,
                    status: LOG_STATUS.RECORD_ERROR
                });
            } finally {
                vc2_util.log(logTitle, '#### END: UPDATE PURCHASE ORDER #####', returnValue);
            }

            return returnValue;
        },

        /**
         * Updates purchase order lines with provided values.
         * @param {Object} option - Options object
         * @param {Object} option.poRec - Purchase Order record
         * @param {Array<Object>} option.lineValues - Line values to update
         * @returns {Object} Update result
         */
        updatePurchaseOrderLines: function (option) {
            var logTitle = [LogTitle, 'updatePurchaseOrderLines'].join('::'),
                returnValue = {};

            var VENDOR_COLS = vc2_constant.VENDOR_LINE_DEF.VENDORLINE_COLS,
                ORDERLINE_COLS = vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                vc2_util.log(logTitle, '#### START: UPDATE PURCHASE ORDER LINES #####');

                var poRec = option.poRec,
                    lineValues = option.lineValues || [];
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error, ERROR_LIST);
                // Fixed: Use vc2_util.extend instead of global util.extend
                ns_util.extend(returnValue, {
                    errorMessage: errorObj.errorMessage,
                    hasError: true,
                    success: false // indicate the fulfillment failed
                });
            } finally {
                vc2_util.log(logTitle, '#### END: UPDATE PURCHASE ORDER LINES #####', returnValue);
            }

            return returnValue;
        },

        /**
         * Creates an Item Fulfillment record based on vendor data.
         * @param {Object} option - Configuration parameters
         * @param {string|number} [option.poId] - Purchase Order internal ID
         * @param {Object} [option.poRec] - Purchase Order record object
         * @param {string|number} [option.soId] - Sales Order internal ID
         * @param {Object} [option.soRec] - Sales Order record object
         * @param {Object} [option.headerValues] - Header field values to set
         * @param {Array<Object>} [option.vendorLines] - Vendor line data to fulfill
         * @param {Object} [option.mainConfig] - Main configuration
         * @param {Object} [option.vendorConfig] - Vendor-specific configuration
         * @param {Object} [option.billConfig] - Bill configuration
         * @returns {Object} Result object with fulfillment details or error information
         */
        createFulfillment: function (option) {
            var logTitle = [LogTitle, 'createFulfillment'].join('::'),
                returnValue = {};

            // Define constants for column and field definitions
            var VENDOR_COLS = vc2_constant.VENDOR_LINE_DEF.VENDORLINE_COLS,
                ORDERLINE_COLS = vc2_constant.VENDOR_LINE_DEF.ORDERLINE_COLS,
                FIELD_DEF = vc2_constant.VENDOR_LINE_DEF.FIELD_DEF,
                MAPPING = vc2_constant.VENDOR_LINE_DEF.MAPPING;

            // var RECORD_NAMES = FULFILL_OPTION[]

            // {};
            // RECORD_NAMES[ns_record.Type.ITEM_FULFILLMENT] = {
            //     code: 'ITEM_FULFILLMENT',
            //     name: 'Item Fulfillment'
            // };
            // RECORD_NAMES[ns_record.Type.ITEM_RECEIPT] = {
            //     code: 'ITEM_RECEIPT',
            //     name: 'Item Receipt'
            // };

            try {
                // Validate required parameters
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };

                // SECTION: Gather necessary records and IDs
                // ----------------------------------------
                var poId = option.poId,
                    poRec = option.poRec,
                    soId = option.soId,
                    soRec = option.soRec,
                    forRecordType = option.forRecordType || ns_record.Type.ITEM_FULFILLMENT;

                var recordName = RECORD_NAMES[forRecordType]
                        ? RECORD_NAMES[forRecordType].name
                        : 'Other Record',
                    recordCode = RECORD_NAMES[forRecordType]
                        ? RECORD_NAMES[forRecordType].code
                        : null;

                vc2_util.log(logTitle, '#### START: ' + recordName + ' CREATION #####', {
                    POID: option.poId,
                    Header: option.headerValues,
                    Lines: option.vendorLines
                });

                // Fixed: Use lowercase vcs_configlib per naming standards
                var mainConfig = option.mainConfig || vcs_configlib.mainConfig(),
                    vendorConfig =
                        option.vendorConfig || vcs_configlib.orderVendorConfig({ poId: poId }),
                    billConfig =
                        option.billConfig || vcs_configlib.billVendorConfig({ poId: poId });

                // SECTION: Determine and load the Sales Order record
                // ------------------------------------------------
                // Try to determine the Sales Order ID if not provided
                if (!soId) {
                    if (soRec) {
                        soId = soRec.id;
                    } else if (poRec) {
                        soId = poRec.getValue({ fieldId: 'createdfrom' });
                    } else if (poId) {
                        var poData = vc2_util.flatLookup({
                            type: ns_record.Type.PURCHASE_ORDER,
                            id: poId,
                            columns: ['createdfrom']
                        });
                        soId = poData.createdfrom.value || poData.createdfrom;
                    }

                    // Throw error if Sales Order ID could not be determined
                    if (!soId) throw { code: 'MISSING_PARAMETER', details: 'soId or poId' };

                    // Load the Sales Order record
                    if (!soRec)
                        soRec = vcs_recordlib.load({ type: ns_record.Type.SALES_ORDER, id: soId });
                }

                // Store IDs in return value
                returnValue.soId = soId;
                returnValue.poId = poId;

                // SECTION: Validate fulfillment eligibility
                // --------------------------------------
                var fulfillmentValidation = this.validateForFulfillment(
                    vc2_util.extend(option, { soId: soId, soRec: soRec })
                );

                if (fulfillmentValidation.hasError) {
                    returnValue.transformValidation = fulfillmentValidation;

                    throw (
                        (fulfillmentValidation &&
                            (fulfillmentValidation.errorMessage ||
                                fulfillmentValidation.code ||
                                fulfillmentValidation.errorCode)) ||
                        'Unknown fulfillment error'
                    );
                }

                // Fixed: Use lowercase vcs_recordlib per naming standards
                var soData = vcs_recordlib.extractValues({
                    record: soRec,
                    columns: [
                        'status',
                        'statusRef',
                        'trandate',
                        'postingperiod',
                        'location',
                        'entity'
                    ]
                });

                var headerValues = option.headerValues || {},
                    lineValues = option.lineValues || [],
                    vendorLines = option.vendorLines || [];

                // SECTION: Prepare Item Fulfillment record
                // -------------------------------------
                // Set up transform options
                var transformOption = {
                    toType: forRecordType,
                    isDynamic: true
                };
                ns_util.extend(
                    transformOption,
                    forRecordType == ns_record.Type.ITEM_FULFILLMENT
                        ? {
                              fromType: ns_record.Type.SALES_ORDER,
                              fromId: soId
                          }
                        : {
                              fromType: ns_record.Type.PURCHASE_ORDER,
                              fromId: poId
                          }
                );

                // Add flag to indicate creation by VC
                ns_util.extend(headerValues, { custbody_ctc_vc_createdby_vc: true });

                // Handle multi-subsidiary inventory locations if applicable
                var inventoryLocations =
                    Helper.getInventoryLocations({
                        poRec: poRec,
                        poId: poId,
                        soRec: soRec,
                        soId: soId
                    }) || [];

                if (forRecordType == ns_record.Type.ITEM_FULFILLMENT)
                    (inventoryLocations || []).forEach(function (location) {
                        transformOption.defaultValues = {
                            // location: location,
                            inventorylocation: location
                        };
                    });

                // Fixed: Use lowercase vcs_recordlib per naming standards
                var itemffRec = vcs_recordlib.transform(transformOption);
                if (!itemffRec)
                    throw { code: 'TRANSFORM_ERROR', message: 'Failed to transform the record' };

                /// get the itemFF Lines
                // Fixed: Use lowercase vcs_recordlib per naming standards
                var arrItemFFLines = vcs_recordlib.extractLineValues({
                    record: itemffRec,
                    sublistId: 'item',
                    additionalColumns: ORDERLINE_COLS.concat([
                        'orderline',
                        'itemname',
                        'lineuniquekey',
                        'location',
                        'inventorydetailreq',
                        'inventorydetailavail',
                        'inventorydetailset',
                        'poline',
                        'binitem',
                        'isserial'
                    ])
                });

                // Fixed: Use lowercase vcs_itemmatch (remove 'Lib' suffix) per naming standards
                vendorLines = vcs_itemmatch.matchOrderLines(
                    vc2_util.extend(option, {
                        ffLines: arrItemFFLines
                        // poRec: poRec,
                        // soRec: soRec,
                        // poId: poId,
                        // vendorLines: (function () {
                        //     vendorLines.forEach(function (vendorLine) {
                        //         vendorLine.AVAILQTY = vendorLine.QUANTITY;
                        //     });
                        //     return vendorLines;
                        // })()
                    })
                );

                // SECTION: Line item matching and processing
                // ---------------------------------------
                var arrLinesToFulfill = [];

                if (!vc2_util.isEmpty(vendorLines)) {
                    // SECTION: Process matched lines and build fulfillment data
                    // -----------------------------------------------------
                    var unmatchedLines = [];

                    // Process each vendor line and its matching fulfillment lines
                    vendorLines.forEach(function (vendorLine) {
                        // Skip lines without matches
                        if (vc2_util.isEmpty(vendorLine.MATCHING)) {
                            unmatchedLines.push(vendorLine);
                            return false;
                        }

                        // Track remaining quantity to apply from this vendor line
                        var appliedQty = vendorLine.APPLIEDQTY;

                        // Process each matching line, and determine how much quantity is applied
                        vendorLine.MATCHING.forEach(function (matchLine) {
                            // Calculate quantity to fulfill on this line,
                            // if the matched line quantity is greater than the applied quantity
                            // use the applied quantity
                            // otherwise use the matched line quantity
                            var itemqty = Math.min(matchLine.quantity, appliedQty);

                            appliedQty -= itemqty;

                            // add this to the fulfillment lines
                            arrLinesToFulfill.push(
                                vc2_util.extend(matchLine, {
                                    itemquantity: itemqty,
                                    quantity: itemqty,
                                    itemreceive: true,
                                    VENDORLINE: vc2_util.extractValues({
                                        source: vendorLine,
                                        fields: VENDOR_COLS
                                    })
                                })
                            );
                        });
                    });

                    // Handle case where some vendor lines couldn't be matched
                    if (!vc2_util.isEmpty(unmatchedLines)) {
                        vc2_util.log(logTitle, 'Unmatched Lines: ', unmatchedLines);
                        throw 'Failed to match the vendor lines';
                    }
                }

                vc2_util.log(logTitle, '... arrLinesToFulfill: ', arrLinesToFulfill);

                // Ensure we have lines to fulfill
                if (vc2_util.isEmpty(arrLinesToFulfill)) throw 'No lines to fulfill';

                // Store line data in return value
                returnValue.Lines = arrLinesToFulfill;

                // SECTION: Process fulfillment lines
                // --------------------------------
                // Determine location and shipping group information
                var lineLocation = Helper.getLineLocation({
                        record: itemffRec,
                        location: soData.location
                    }),
                    lineShipGroup = Helper.getShipGroup({
                        poRec: poRec,
                        poId: poId,
                        soRec: soRec,
                        soId: soId
                    });

                // Collection objects for serials and packages
                var arrSerials = {},
                    arrValidPackages = [];

                // SECTION: Process each line in the Item Fulfillment record
                // -------------------------------------------------------
                var lineCount = itemffRec.getLineCount({ sublistId: 'item' });

                // Process lines in reverse to avoid index changes when skipping lines
                for (var line = lineCount - 1; line >= 0; line--) {
                    try {
                        // Extract current line data
                        var itemffLine = vcs_recordlib.extractLineValues({
                            record: itemffRec,
                            sublistId: 'item',
                            line: line,
                            additionalColumns: ORDERLINE_COLS.concat([
                                'orderline',
                                'itemname',
                                'lineuniquekey',
                                'location',
                                'inventorydetailreq',
                                'inventorydetailavail',
                                'inventorydetailset',
                                'poline',
                                'binitem',
                                'isserial'
                            ])
                        });

                        // Find matching line from our processed vendor data
                        var matchingLinesToFF = arrLinesToFulfill.filter(function (poLine) {
                            var returnValue = false;

                            if (vc2_util.isEmpty(poLine.FFLINE)) return false;

                            if (forRecordType == ns_record.Type.ITEM_FULFILLMENT) {
                                returnValue = poLine.FFLINE.line == itemffLine.line;
                            } else if (forRecordType == ns_record.Type.ITEM_RECEIPT) {
                                returnValue = poLine.FFLINE.line == itemffLine.line;
                            }

                            return returnValue;
                        });

                        // Skip lines not in our fulfillment list
                        if (vc2_util.isEmpty(matchingLinesToFF)) {
                            // Mark the line as not received
                            vcs_recordlib.updateLineValues({
                                record: itemffRec,
                                values: { itemreceive: false },
                                line: line,
                                isDynamic: true
                            });

                            vc2_util.log(
                                logTitle,
                                '...skipped line: ',
                                [line, itemffLine.itemname].join('|')
                            );
                            continue;
                        }

                        vc2_util.log(
                            logTitle,
                            '...adding  line: ',
                            [line, itemffLine.itemname].join('|')
                        );

                        var resultLine = matchingLinesToFF.reduce(function (lineValue, curLine) {
                            lineValue.itemquantity =
                                (lineValue.itemquantity || 0) + curLine.itemquantity;

                            // loop through the VENDORLINE fields
                            for (var fld in curLine.VENDORLINE) {
                                // if (
                                //     !vc2_util.inArray(fld, [
                                //         'CARRIER',
                                //         'TRACKING_NUMS',
                                //         'SERIAL_NUMS'
                                //     ])
                                // )
                                //     continue;

                                var value = lineValue.VENDORLINE[fld],
                                    arrValue = value.split(/,|\s/),
                                    curValue = curLine.VENDORLINE[fld];

                                // skip if curValue is not valid value
                                if (curValue == 'NA' || vc2_util.isEmpty(curValue)) continue;

                                if (!vc2_util.inArray(curValue, arrValue)) {
                                    arrValue.push(curValue);
                                }

                                lineValue.VENDORLINE[fld] = arrValue.join(',');
                            }

                            return lineValue;
                        });

                        // SECTION: Prepare line data
                        // --------------------------
                        // Organize data for processing
                        var LineData = {
                                Vendor: resultLine.VENDORLINE,
                                PO: resultLine,
                                ItemFF: itemffLine
                            },
                            Tracking = {
                                Vendor:
                                    LineData.Vendor.TRACKING && LineData.Vendor.TRACKING != 'NA'
                                        ? util.isArray(LineData.Vendor.TRACKING)
                                            ? LineData.Vendor.TRACKING
                                            : util.isString(LineData.Vendor.TRACKING)
                                              ? LineData.Vendor.TRACKING.split(/,|\s/)
                                              : null
                                        : LineData.Vendor.TRACKING_NUMS &&
                                            LineData.Vendor.TRACKING_NUMS != 'NA'
                                          ? util.isArray(LineData.Vendor.TRACKING_NUMS)
                                              ? LineData.Vendor.TRACKING_NUMS
                                              : util.isString(LineData.Vendor.TRACKING_NUMS)
                                                ? LineData.Vendor.TRACKING_NUMS.split(/,|\s/)
                                                : null
                                          : null,

                                PO:
                                    LineData.PO['custcol_ctc_xml_tracking_num'] &&
                                    LineData.PO['custcol_ctc_xml_tracking_num'] != 'NA'
                                        ? LineData.PO['custcol_ctc_xml_tracking_num'].split(/,|\s/)
                                        : null,
                                ItemFF:
                                    LineData.ItemFF['custcol_ctc_xml_tracking_num'] &&
                                    LineData.ItemFF['custcol_ctc_xml_tracking_num'] != 'NA'
                                        ? LineData.ItemFF['custcol_ctc_xml_tracking_num'].split(
                                              /,|\s/
                                          )
                                        : null
                            },
                            Serials = {
                                Vendor:
                                    LineData.Vendor.SERIAL_NUMS &&
                                    LineData.Vendor.SERIAL_NUMS !== 'NA'
                                        ? util.isArray(LineData.Vendor.SERIAL_NUMS)
                                            ? LineData.Vendor.SERIAL_NUMS
                                            : util.isString(LineData.Vendor.SERIAL_NUMS)
                                              ? LineData.Vendor.SERIAL_NUMS.split(/,|\s/)
                                              : null
                                        : null,

                                PO:
                                    LineData.PO['custcol_ctc_xml_serial_num'] &&
                                    LineData.PO['custcol_ctc_xml_serial_num'] != 'NA'
                                        ? LineData.PO['custcol_ctc_xml_serial_num'].split(/,|\s/)
                                        : null,
                                ItemFF:
                                    LineData.ItemFF['custcol_ctc_xml_serial_num'] &&
                                    LineData.ItemFF['custcol_ctc_xml_serial_num'] != 'NA'
                                        ? LineData.ItemFF['custcol_ctc_xml_serial_num'].split(
                                              /,|\s/
                                          )
                                        : null
                            },
                            Carrier = {
                                Vendor: LineData.Vendor.CARRIER || '',
                                PO: LineData.PO['custcol_ctc_xml_carrier'] || '',
                                ItemFF: LineData.ItemFF['custcol_ctc_xml_carrier'] || ''
                            };

                        // Generate line values from vendor data
                        // Fixed: Use vc2_util.extend instead of global util.extend
                        var lineValues = vc2_util.extend(
                            {
                                itemreceive: true,
                                itemquantity: resultLine.itemquantity,
                                quantity: resultLine.itemquantity
                            },
                            Helper.setVendorLineValues({
                                vendorLine: LineData.Vendor,
                                poLineValue: LineData.PO
                            })
                        );

                        // Process tracking numbers - get unique set from all sources
                        var LineTracking = (function () {
                            // Use hierarchical priority: Vendor > ItemFF > PO
                            var trackingArray = [];
                            if (!vc2_util.isEmpty(Tracking.Vendor)) {
                                trackingArray = Tracking.Vendor;
                            } else if (!vc2_util.isEmpty(Tracking.ItemFF)) {
                                trackingArray = Tracking.ItemFF;
                            } else if (!vc2_util.isEmpty(Tracking.PO)) {
                                trackingArray = Tracking.PO;
                            }

                            return vc2_util.uniqueArray(
                                trackingArray.filter(function (track) {
                                    return !vc2_util.isEmpty(track) && track != 'NA';
                                })
                            );
                        })();
                        // Accumulate tracking numbers
                        arrValidPackages = arrValidPackages.concat(LineTracking);

                        // only for item receipts
                        if (
                            forRecordType !== ns_record.Type.ITEM_RECEIPT ||
                            !mainConfig.useInboundTrackingNumbers
                        ) {
                            lineValues[vc2_constant.FIELD.TRANSACTION.INBOUND_TRACKING_NUM] = null;
                        }

                        // Set location and ship group if available
                        if (lineLocation) lineValues.location = lineLocation;
                        if (lineShipGroup) lineValues.shipgroup = lineShipGroup;

                        // Only update fields that have changed
                        var updateLineValues = {};
                        for (var fld in lineValues) {
                            if (LineData.ItemFF[fld] !== lineValues[fld]) {
                                updateLineValues[fld] = lineValues[fld];
                            }
                        }

                        // Update the line with new values
                        vcs_recordlib.updateLineValues({
                            record: itemffRec,
                            line: line,
                            values: updateLineValues,
                            isDynamic: true
                        });

                        vc2_util.log(logTitle, '...added line: ', [
                            [line, itemffLine.itemname].join('|'),
                            updateLineValues
                        ]);

                        // SECTION: Process serial numbers and tracking data
                        // ----------------------------------------------
                        // Process serial numbers - get unique set from vendor and existing data
                        var LineSerials = (function () {
                                return vc2_util.uniqueArray(
                                    (Serials.Vendor || [])
                                        .concat(Serials.ItemFF || [])
                                        .filter(function (serial) {
                                            return !vc2_util.isEmpty(serial) && serial != 'NA';
                                        })
                                );
                            })(),
                            // Process carrier information
                            Carrier = (function () {
                                return vc2_util.uniqueArray(
                                    [Carrier.Vendor, Carrier.PO, Carrier.ItemFF].filter(
                                        function (carr) {
                                            return !vc2_util.isEmpty(carr) && carr != 'NA';
                                        }
                                    )
                                );
                            })();

                        // Store serial numbers by item
                        arrSerials[LineData.PO.item] = LineSerials;

                        vc2_util.log(logTitle, '......serials/tracking/carrier: ', [
                            LineSerials,
                            LineTracking,
                            Carrier
                        ]);

                        // Add serial numbers to inventory detail if available
                        if (!vc2_util.isEmpty(LineSerials)) {
                            Helper.addInventoryDetails({
                                record: itemffRec,
                                line: line,
                                lineData: LineData.ItemFF,
                                serials: LineSerials,
                                doCommit: true
                            });
                        }
                    } catch (line_err) {
                        vclib_error.log(logTitle, line_err, ERROR_LIST);
                    }
                }

                // SECTION: Set header field values
                // ------------------------------
                vc2_util.log(logTitle, '___ headerValues: ', headerValues);

                Helper.setHeaderValues({
                    record: itemffRec,
                    headerValues: headerValues
                });

                // SECTION: Add package tracking information
                // --------------------------------------
                if (forRecordType == ns_record.Type.ITEM_FULFILLMENT) {
                    Helper.addNativePackages({
                        record: itemffRec,
                        packages: vc2_util.uniqueArray(arrValidPackages)
                    });

                    // Store tracking numbers in return value
                    returnValue.Tracking = arrValidPackages;
                }

                /// VALIDATE BEFORE SAVING TO A FULFILLMENT ////
                var validateResult = (function () {
                    var returnValue = {};

                    try {
                        var arrFFLines = vcs_recordlib.extractLineValues({
                            record: itemffRec,
                            sublistId: 'item',
                            additionalColumns: ORDERLINE_COLS.concat([
                                'itemreceive',
                                'orderline',
                                'itemname',
                                'lineuniquekey',
                                'poline'
                            ])
                        });
                        if (vc2_util.isEmpty(arrFFLines)) throw 'No lines to fulfill';

                        // make sure to only fulfill whats on the vendorLines
                        var hasUnmatchedFFline = false,
                            hasUnappliedQty = false;

                        // get all the itemreceived=true
                        var arrAppliedLines = [];
                        arrFFLines.forEach(function (ffline) {
                            if (!ffline.itemreceive) return;

                            var appliedLineQty = ffline.quantity || 0,
                                appliedFFLineQty = 0;

                            var matchedVendorLine = vendorLines.filter(function (vendorLine) {
                                var matchedFFLine = vendorLine.MATCHING.filter(
                                    function (matchedLine) {
                                        return (
                                            matchedLine.FFLINE &&
                                            matchedLine.FFLINE.line == ffline.line
                                        );
                                    }
                                );

                                return !vc2_util.isEmpty(matchedFFLine);
                            });

                            arrAppliedLines.push(ffline);
                        });

                        if (vc2_util.isEmpty(arrAppliedLines))
                            throw 'No lines to fulfill with itemreceive=true';

                        returnValue.success = true;

                        // check for vendor line count
                        // if (arrItemReceived.length > vendorLines.length)
                        //     throw 'Received lines is greater than vendor lines';
                    } catch (error) {
                        var err = vclib_error.log(logTitle, error);

                        util.extend(returnValue, {
                            hasError: true,
                            success: false,
                            error: err.message
                        });
                    }
                    return returnValue;
                })();
                ////////////////////////////////////////////////

                if (validateResult.hasError)
                    throw { code: 'FF_VALIDATE_ERROR', details: validateResult.error };

                // SECTION: Save the fulfillment record
                // ----------------------------------
                var fulfillmentId = itemffRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                if (!fulfillmentId) throw 'FULFILLMENT_ERROR';

                vc2_util.log(logTitle, '**** ' + recordName + ' Success ****', fulfillmentId);

                // Update return value with fulfillment ID and success flag
                returnValue.id = fulfillmentId;
                returnValue.success = true;

                // SECTION: Format serial numbers for return data
                // -------------------------------------------
                returnValue.Serials = [];
                for (var item in arrSerials) {
                    var serials = arrSerials[item];
                    if (vc2_util.isEmpty(serials)) continue;

                    var serialData = {
                        serials: serials,
                        ITEM: item,
                        CUSTOMER: soData.entity,
                        PURCHASE_ORDER: poId,
                        SALES_ORDER: soId
                    };
                    serialData[recordCode] = fulfillmentId;

                    returnValue.Serials.push(serialData);
                }
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error, ERROR_LIST),
                    errorMsg = errorObj.message;

                // Handle and log errors
                // Fixed: Use vc2_util.extend instead of global util.extend
                ns_util.extend(returnValue, {
                    errorObj: errorObj,
                    errorMessage: errorMsg,
                    message: errorMsg,
                    errorCode: errorObj.code || 'FULFILLMENT_ERROR',
                    code: errorObj.code || 'FULFILLMENT_ERROR',
                    hasError: true,
                    success: false // indicate the fulfillment failed
                });
            } finally {
                vc2_util.log(logTitle, '#### END: ' + recordName + ' CREATION #####');
            }

            return returnValue;
        },

        /**
         * Transforms a Sales Order to Item Fulfillment and auto-fulfills lines.
         * @param {string|number} stSoId - Sales Order ID
         * @param {Array<Object>} arrValues - Line values to fulfill
         */
        recordTransformAutoFulfill: function (stSoId, arrValues) {
            var logTitle = 'recordTransformAutoFulfill - Create Item Fulfillment';
            var stPoId = arrValues[0].internalid.value;
            try {
                var objRec = ns_record.transform({
                    fromType: ns_record.Type.SALES_ORDER,
                    fromId: stSoId,
                    toType: ns_record.Type.ITEM_FULFILLMENT,
                    isDynamic: true
                });
                objRec.setValue({
                    fieldId: 'shipstatus',
                    value: 'C'
                });
                Helper.autoFulfillSetItem(objRec, arrValues, stPoId);
                var ifId = objRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                vc2_util.vcLog({
                    title: logTitle,
                    recordId: stPoId,
                    message: 'successfully created IF ID: ' + ifId,
                    status: LOG_STATUS.SUCCESS
                });
            } catch (ex) {
                vc2_util.vcLog({
                    title: logTitle + ' | Error',
                    recordId: stPoId,
                    message: ex.message || ex.toString(),
                    status: LOG_STATUS.ERROR
                });
            }
        },

        /**
         * Transforms a Purchase Order to Item Receipt and auto-fulfills lines.
         * @param {string|number} stPoId - Purchase Order ID
         * @param {Array<Object>} arrValues - Line values to receive
         */
        recordTransformItemReceipt: function (stPoId, arrValues) {
            var logTitle = 'Auto Fulfill Lines - Create Item Receipt';
            try {
                var irRec = ns_record.transform({
                    fromType: ns_record.Type.PURCHASE_ORDER,
                    fromId: stPoId,
                    toType: ns_record.Type.ITEM_RECEIPT,
                    isDynamic: true
                });
                Helper.autoFulfillSetItem(irRec, arrValues, stPoId);
                var irId = irRec.save({
                    enableSourcing: true,
                    ignoreMandatoryFields: true
                });

                vc2_util.vcLog({
                    title: logTitle + ' | Record Transform',
                    recordId: stPoId,
                    message: 'successfully created IR ID: ' + irId,
                    status: LOG_STATUS.SUCCESS
                });
            } catch (ex) {
                vc2_util.vcLog({
                    title: logTitle + ' | Error',
                    recordId: stPoId,
                    message: ex.message || ex.toString(),
                    status: LOG_STATUS.ERROR
                });
            }
        }
    };

    return TransactionLib;
});
