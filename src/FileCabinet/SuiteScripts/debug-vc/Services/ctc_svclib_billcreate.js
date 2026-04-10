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
 * Script Name: VC Services | Bill Create Library
 *
 * @author brianf@nscatalyst.com
 * @description Services-side bill file retrieval and creation library. Bridges vendor invoice
 *   API responses into Bill File custom records, with item matching, PO linking, duplicate
 *   detection, vendor due-date calculation, and bill file data loading/saving.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-04-01   brianf        Rewrote as full Services-layer module: added retrieveBills, fetchPOData, fetchInvoiceData,
 *                            billFileExists, isValidBillFile, fetchVendorDueDate, lookupVendorTerms; migrated imports to
 *                            vclib_utils/vclib_error/vclib_constant; kept linkPOItems, loadBillFile, saveBillFile, addProcessLog
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'SVC:BillCreate';

    var ns_search = require('N/search'),
        ns_record = require('N/record'),
        ns_config = require('N/config'),
        ns_format = require('N/format'),
        ns_https = require('N/https'),
        ns_util = require('N/util');

    var vc2_constant = require('./../CTC_VC2_Constants.js');

    var vclib_utils = require('./lib/ctc_lib_utils.js'),
        vclib_constant = require('./lib/ctc_lib_constants.js'),
        vclib_error = require('./lib/ctc_lib_error.js'),
        vclib_moment = require('./lib/moment.js');

    var vcs_configLib = require('./ctc_svclib_configlib.js'),
        vcs_recordLib = require('./ctc_svclib_records.js'),
        vcs_itemMatchLib = require('./ctc_svclib_itemmatch.js');

    var BILLFILE = vc2_constant.RECORD.BILLFILE;

    var ERROR_LIST = {
        MISSING_PARAMETER: {
            code: 'MISSING_PARAMETER',
            message: 'Required parameter is missing: {details}',
            level: vclib_error.ErrorLevel.ERROR
        },
        MISSING_PO: {
            code: 'MISSING_PO',
            message: 'PO Link is not found',
            level: vclib_error.ErrorLevel.ERROR
        },
        MISSING_CONFIG: {
            code: 'MISSING_CONFIG',
            message: 'No bill vendor configuration found',
            level: vclib_error.ErrorLevel.ERROR
        },
        EMPTY_RESPONSE: {
            code: 'EMPTY_RESPONSE',
            message: 'Empty or invalid vendor invoice response',
            level: vclib_error.ErrorLevel.WARNING
        },
        BILLFILE_EXISTS: {
            code: 'BILLFILE_EXISTS',
            message: 'Bill file already exists for this invoice',
            level: vclib_error.ErrorLevel.WARNING
        },
        INVALID_BILLFILE: {
            code: 'INVALID_BILLFILE',
            message: 'Bill file data is invalid or incomplete',
            level: vclib_error.ErrorLevel.WARNING
        }
    };

    var CACHE = {};
    var MainCFG = null,
        BillCFG = null,
        VendorCFG = null;

    var dateFormat = null;

    var Helper = {
        parseDate: function (option) {
            var logTitle = [LogTitle, 'parseDate'].join('::'),
                returnValue = null;

            option = option || {};
            var dateString = option.dateString || option;

            try {
                if (dateString && dateString.length > 0 && dateString != 'NA') {
                    var dateValue = vclib_moment(dateString).toDate();
                    if (dateValue) {
                        returnValue = ns_format.format({
                            value: dateValue,
                            type: ns_format.Type.DATE
                        });
                    }
                }
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        searchVendorsByConfig: function (configId) {
            var logTitle = [LogTitle, 'searchVendorsByConfig'].join('::'),
                returnValue = null;

            var cacheStr = 'vendorConfig:' + configId;
            if (CACHE[cacheStr]) return CACHE[cacheStr];

            try {
                var arrVendors = [];
                ns_search
                    .create({
                        type: 'vendor',
                        filters: [['custentity_vc_bill_config', 'anyof', configId]],
                        columns: ['internalid', 'entityid', 'custentity_vc_bill_config']
                    })
                    .run()
                    .each(function (result) {
                        arrVendors.push(result.getValue({ name: 'internalid' }));
                        return true;
                    });

                returnValue = arrVendors;
                CACHE[cacheStr] = returnValue;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        fetchPOData: function (option) {
            var logTitle = [LogTitle, 'fetchPOData'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var poNumList = option.poNumList || option.poNums || [];
                if (vclib_utils.isEmpty(poNumList)) throw { code: 'MISSING_PARAMETER', details: 'poNumList' };

                if (!MainCFG) MainCFG = vcs_configLib.mainConfig();

                var searchOption = {
                    type: 'purchaseorder',
                    filters: [
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['type', 'anyof', 'PurchOrd'],
                        'AND',
                        (function (poNums, chunkSize) {
                            if (!chunkSize) chunkSize = 10;
                            var formulaParts = [];
                            for (var i = 0; i < poNums.length; i += chunkSize) {
                                var chunk = poNums.slice(i, i + chunkSize);
                                var csv = ',' + chunk.join(',') + ',';
                                formulaParts.push(
                                    "INSTR('" + csv + "', ',' || {number} || ',') > 0"
                                );
                                if (MainCFG.overridePONum) {
                                    formulaParts.push(
                                        "INSTR('" +
                                            csv +
                                            "', ',' || {custbody_ctc_vc_override_ponum} || ',') > 0"
                                    );
                                }
                            }
                            var formula =
                                'CASE WHEN (' +
                                formulaParts.join(' OR ') +
                                ") THEN 'Y' ELSE 'N' END";
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
                        MainCFG.overridePONum ? 'custbody_ctc_vc_override_ponum' : 'tranid',
                        vclib_constant.GLOBAL.ENABLE_SUBSIDIARIES ? 'subsidiary' : 'tranid'
                    ]
                };

                var searchObj = ns_search.create(searchOption);
                if (!searchObj.runPaged().count) {
                    vclib_utils.log(logTitle, 'PO Data not found', { list: poNumList });
                    return false;
                }

                var listPOData = {};
                searchObj
                    .run()
                    .getRange({ start: 0, end: 1000 })
                    .forEach(function (searchResult) {
                        var poData = {
                            id: searchResult.getValue({ name: 'internalid' }),
                            entityId: searchResult.getValue({ name: 'entity' }),
                            entityName: searchResult.getText({ name: 'entity' }),
                            tranId: searchResult.getValue({ name: 'tranid' }),
                            date: searchResult.getValue({ name: 'trandate' }),
                            subsidiary: vclib_constant.GLOBAL.ENABLE_SUBSIDIARIES
                                ? searchResult.getValue({ name: 'subsidiary' })
                                : null
                        };
                        listPOData[poData.tranId] = poData;

                        if (MainCFG.overridePONum) {
                            var overridePONum = searchResult.getValue({
                                name: 'custbody_ctc_vc_override_ponum'
                            });
                            if (overridePONum && overridePONum != poData.tranId) {
                                listPOData[overridePONum] = poData;
                            }
                        }
                    });

                returnValue = listPOData;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        fetchInvoiceData: function (option) {
            var logTitle = [LogTitle, 'fetchInvoiceData'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var invoiceNumList = option.invoiceNumList || option.invoiceNums || [];
                if (vclib_utils.isEmpty(invoiceNumList)) return false;

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
                    ]
                });

                if (!searchObj.runPaged().count) return false;

                var listInvoiceData = {};
                searchObj
                    .run()
                    .getRange({ start: 0, end: 1000 })
                    .forEach(function (searchResult) {
                        var invoiceData = {
                            id: searchResult.getValue({ name: 'id' }),
                            tranId: searchResult.getValue({
                                name: 'custrecord_ctc_vc_bill_number'
                            }),
                            jsonData: searchResult.getValue({
                                name: 'custrecord_ctc_vc_bill_json'
                            }),
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

                        if (!listInvoiceData[invoiceData.tranId]) {
                            listInvoiceData[invoiceData.tranId] = [];
                        }
                        listInvoiceData[invoiceData.tranId].push(invoiceData);
                    });

                returnValue = listInvoiceData;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        isValidBillFile: function (billFileData, arrErrors) {
            var logTitle = [LogTitle, 'isValidBillFile'].join('::'),
                returnValue = null;

            if (!ns_util.isArray(arrErrors)) arrErrors = [];

            try {
                if (!billFileData.linkedPO) throw 'PO Link is not found';

                var BillCreator = vc2_constant.Bill_Creator;
                if (
                    !vclib_utils.inArray(billFileData.procStatus, [
                        BillCreator.Status.PENDING,
                        BillCreator.Status.ERROR
                    ])
                ) {
                    return true;
                }

                var parsedJSON = vclib_utils.safeParse(billFileData.jsonData);
                if (!parsedJSON || !parsedJSON.lines || !parsedJSON.lines.length) {
                    throw 'Invalid JSON data';
                }

                parsedJSON.lines.forEach(function (line) {
                    var lineQty = line.hasOwnProperty('QUANTITY') ? line.QUANTITY : 0;
                    if (lineQty <= 0) return true;
                    if (!line.hasOwnProperty('ITEMNO')) throw 'Invalid JSON data - missing ITEMNO';
                    return true;
                });

                returnValue = true;
            } catch (validate_error) {
                vclib_error.warn(logTitle, validate_error, ERROR_LIST);
                arrErrors.push(validate_error);
                returnValue = false;
            }

            return returnValue;
        },
        billFileExists: function (option, allBillFileData) {
            var logTitle = [LogTitle, 'billFileExists'].join('::'),
                returnValue = null;

            try {
                var BillCreator = vc2_constant.Bill_Creator;
                if (!option || !option.invoice) return false;

                var invoiceNo = option.invoice.toString().trim();
                var invalidBillFiles = [],
                    arrErrors = [];

                var arrInvoiceData = allBillFileData[invoiceNo];
                if (vclib_utils.isEmpty(arrInvoiceData)) return false;

                var listLinkedBill = arrInvoiceData.filter(function (bf) {
                    return bf.linkedBill;
                });

                var linkedBillProcessed = !vclib_utils.isEmpty(listLinkedBill)
                    ? listLinkedBill.filter(function (bf) {
                          return (
                              bf.linkedBill && bf.procStatus == BillCreator.Status.PROCESSED
                          );
                      })
                    : [];

                var validLinkedBill =
                    linkedBillProcessed.length > 0
                        ? linkedBillProcessed[0]
                        : listLinkedBill.length == 1
                          ? listLinkedBill[0]
                          : null;

                if (arrInvoiceData.length == 1 && validLinkedBill) return true;

                var hasValidBillFile = !vclib_utils.isEmpty(validLinkedBill);

                arrInvoiceData.forEach(function (billFileData) {
                    try {
                        if (billFileData.linkedBill) {
                            if (validLinkedBill && validLinkedBill.id == billFileData.id) {
                                return true;
                            } else {
                                throw 'Duplicate linkedBill bill file';
                            }
                        }
                        if (!Helper.isValidBillFile(billFileData, arrErrors)) {
                            throw 'Invalid bill file';
                        }
                        if (hasValidBillFile) throw 'Duplicate bill file';
                        hasValidBillFile = true;
                    } catch (validate_error) {
                        vclib_error.warn(logTitle, validate_error, ERROR_LIST);
                        invalidBillFiles.push(billFileData);
                    }
                    return true;
                });

                if (!vclib_utils.isEmpty(invalidBillFiles)) {
                    invalidBillFiles.forEach(function (row) {
                        ns_record.delete({ type: 'customrecord_ctc_vc_bills', id: row.id });
                    });
                }

                returnValue = hasValidBillFile;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        lookupVendorTerms: function (entityId) {
            var logTitle = [LogTitle, 'lookupVendorTerms'].join('::'),
                returnValue = 0;

            try {
                var searchTerms = ns_search.lookupFields({
                    type: ns_search.Type.VENDOR,
                    id: entityId,
                    columns: ['terms']
                });
                if (searchTerms && searchTerms.terms && searchTerms.terms.length) {
                    returnValue = searchTerms.terms[0].value;
                }
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        fetchVendorDueDate: function (entityId) {
            var logTitle = [LogTitle, 'fetchVendorDueDate'].join('::'),
                returnValue = null;

            try {
                var vendorTerms =
                    vclib_utils.getNSCache({
                        cacheKey: ['vendorTerms', entityId].join(':')
                    }) ||
                    (function () {
                        var terms;
                        var searchTerms = ns_search.lookupFields({
                            type: ns_search.Type.VENDOR,
                            id: entityId,
                            columns: ['terms']
                        });
                        if (searchTerms.terms && searchTerms.terms.length > 0) {
                            terms = searchTerms.terms[0].value;
                            vclib_utils.setNSCache({
                                cacheKey: ['vendorTerms', entityId].join(':'),
                                value: terms
                            });
                        }
                        return terms;
                    })();

                if (!vendorTerms) throw 'No payment terms found';

                var daysToPay =
                    vclib_utils.getNSCache({
                        cacheKey: ['termsDays', vendorTerms].join(':')
                    }) ||
                    (function () {
                        var days;
                        var searchTerms = ns_search.lookupFields({
                            type: ns_search.Type.TERM,
                            id: vendorTerms,
                            columns: ['daysuntilnetdue']
                        });
                        if (searchTerms.daysuntilnetdue) {
                            days = parseInt(searchTerms.daysuntilnetdue);
                            vclib_utils.setNSCache({
                                cacheKey: ['termsDays', vendorTerms].join(':'),
                                value: days
                            });
                        }
                        return days;
                    })();

                if (isNaN(parseInt(daysToPay, 10))) throw 'No days found for terms';
                returnValue = daysToPay;
            } catch (error) {
                vclib_error.warn(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        searchPO: function (option) {
            var logTitle = [LogTitle, 'searchPO'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                if (!MainCFG) MainCFG = vcs_configLib.mainConfig();

                var poId = option.poId || option.po,
                    poNum = option.poNum || option.ponum;

                if (!poId && !poNum) throw { code: 'MISSING_PARAMETER', details: 'PO identifier' };

                var searchObj = ns_search.create({
                    type: 'purchaseorder',
                    filters: [
                        poId
                            ? ['internalid', 'anyof', poId]
                            : MainCFG.overridePONum
                              ? [
                                    ['numbertext', 'is', poNum],
                                    'OR',
                                    ['custbody_ctc_vc_override_ponum', 'is', poNum]
                                ]
                              : ['numbertext', 'is', poNum],
                        'AND',
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['type', 'anyof', 'PurchOrd']
                    ],
                    columns: [
                        'trandate',
                        'postingperiod',
                        'type',
                        MainCFG.overridePONum ? 'custbody_ctc_vc_override_ponum' : 'tranid',
                        'tranid',
                        'entity',
                        'amount',
                        'internalid'
                    ]
                });

                var poData = false;
                if (searchObj.runPaged().count) {
                    var searchResult = searchObj.run().getRange({ start: 0, end: 1 }).shift();
                    poData = {
                        id: searchResult.getValue({ name: 'internalid' }),
                        entityId: searchResult.getValue({ name: 'entity' }),
                        entityName: searchResult.getText({ name: 'entity' }),
                        tranId: searchResult.getValue({ name: 'tranid' }),
                        date: searchResult.getValue({ name: 'trandate' })
                    };
                    VendorCFG = vcs_configLib.orderVendorConfig({ poId: poData.id });
                }

                returnValue = poData;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        extractVendorItemNames: function (option) {
            var logTitle = [LogTitle, 'extractVendorItemNames'].join('::'),
                returnValue = null;

            try {
                var arrItemList = option.lines || option;
                var ItemMapRecordVar = vc2_constant.RECORD.VENDOR_ITEM_MAPPING;

                if (!arrItemList || !arrItemList.length) throw 'Missing line item list';

                var uniqueItemIds = vclib_utils.uniqueArray(arrItemList);
                if (!uniqueItemIds.length) throw 'Missing line item lists';

                var searchResults = vclib_utils.searchAllPaged({
                    type: ItemMapRecordVar.ID,
                    filterExpression: [
                        [ItemMapRecordVar.FIELD.ITEM, 'anyof', uniqueItemIds],
                        'and',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: [ItemMapRecordVar.FIELD.NAME, ItemMapRecordVar.FIELD.ITEM]
                });

                if (!searchResults || !searchResults.length) {
                    throw 'No vendor item mapped for items';
                }

                var vendorItemMap = {};
                searchResults.forEach(function (result) {
                    var vendorItemName = result.getValue({ name: ItemMapRecordVar.FIELD.NAME }),
                        item = result.getValue({ name: ItemMapRecordVar.FIELD.ITEM });

                    if (!vendorItemMap[item]) vendorItemMap[item] = [];
                    vendorItemMap[item].push(vendorItemName);
                    return true;
                });

                returnValue = vendorItemMap;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        extractItemNames: function (option) {
            var logTitle = [LogTitle, 'extractItemNames'].join('::'),
                returnValue = null;

            try {
                var arrItemList = option.lines || option;
                if (!arrItemList || !arrItemList.length) throw 'Missing line item list';

                var uniqueItemIds = vclib_utils.uniqueArray(arrItemList);
                if (!uniqueItemIds.length) throw 'No valid item IDs found';

                var searchResults = vclib_utils.searchAllPaged({
                    type: 'item',
                    filterExpression: [
                        ['internalid', 'anyof', uniqueItemIds],
                        'and',
                        ['isinactive', 'is', 'F']
                    ],
                    columns: ['itemid', 'displayname', 'internalid']
                });

                if (!searchResults || !searchResults.length) throw 'No items found';

                var itemNameMap = {};
                searchResults.forEach(function (result) {
                    var itemId = result.getValue({ name: 'internalid' }),
                        itemName = result.getValue({ name: 'itemid' }),
                        displayName = result.getValue({ name: 'displayname' });
                    itemNameMap[itemId] = { name: itemName, displayName: displayName };
                    return true;
                });

                returnValue = itemNameMap;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        addNote: function (option) {
            var logTitle = [LogTitle, 'addNote'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var billFileId = option.billFileId || option.billId || option.id,
                    notes = option.note || option.notes || option.content,
                    allNotes = option.all || option.allNotes || option.current || '';

                if (billFileId) {
                    var recData = ns_search.lookupFields({
                        type: 'customrecord_ctc_vc_bills',
                        id: billFileId,
                        columns: ['custrecord_ctc_vc_bill_log']
                    });
                    allNotes = recData.custrecord_ctc_vc_bill_log;
                }

                if (notes) {
                    allNotes =
                        allNotes +
                        '\r\n' +
                        vclib_moment().format('MM/DD/YYYY') +
                        ' - ' +
                        notes;
                }

                var arrNotes = [];
                allNotes.split(/\r\n/).forEach(function (line) {
                    if (arrNotes.indexOf(line) < 0) arrNotes.push(line);
                });
                var newNoteStr = arrNotes.join('\r\n');

                if (billFileId) {
                    ns_record.submitFields({
                        type: 'customrecord_ctc_vc_bills',
                        id: billFileId,
                        values: { custrecord_ctc_vc_bill_log: newNoteStr },
                        options: { ignoreMandatoryFields: true }
                    });
                }

                returnValue = newNoteStr;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        }
    };

    var BillFileCreateLib = {
        retrieveBills: function (option) {
            var logTitle = [LogTitle, 'retrieveBills'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var configObj = option.configObj || option.config,
                    billDataArr = option.billDataArr || option.invoices,
                    batchName = option.name || option.batchName;

                if (!billDataArr || !billDataArr.length) throw 'EMPTY_RESPONSE';

                MainCFG = vcs_configLib.mainConfig();

                if (!dateFormat) {
                    var generalPref = ns_config.load({
                        type: ns_config.Type.COMPANY_PREFERENCES
                    });
                    dateFormat = generalPref.getValue({ fieldId: 'DATEFORMAT' });
                }

                var arrPONums = vclib_utils.uniqueArray(
                    billDataArr
                        .map(function (item) {
                            var poNum = item.ordObj && item.ordObj.po;
                            return poNum ? poNum.toString().trim() : null;
                        })
                        .filter(function (v) {
                            return v;
                        })
                );

                var arrPOData = Helper.fetchPOData({ poNumList: arrPONums });

                var arrInvoiceNums = billDataArr.map(function (item) {
                    var invoiceNum = item.ordObj && item.ordObj.invoice;
                    return invoiceNum ? invoiceNum.toString().trim() : null;
                });
                var arrInvoiceData = Helper.fetchInvoiceData({ invoiceNumList: arrInvoiceNums });

                var createdBillFiles = [];

                for (var i = 0; i < billDataArr.length; i++) {
                    var billObj = billDataArr[i].ordObj;
                    var LogPrefix = '[' + billObj.invoice + '] ';
                    vclib_utils.LogPrefix = LogPrefix;

                    vclib_utils.log(
                        logTitle,
                        '###### PROCESSING [' + billObj.invoice + '] ######'
                    );

                    if (Helper.billFileExists(billObj, arrInvoiceData || {})) {
                        vclib_utils.log(logTitle, '...already exists, skipping');
                        continue;
                    }

                    var billFileNotes = [];
                    var billFileValues = {
                        name: [batchName, billObj.invoice].join(':'),
                        custrecord_ctc_vc_bill_file_position: i + 1,
                        custrecord_ctc_vc_bill_po: billObj.po,
                        custrecord_ctc_vc_bill_number: billObj.invoice,
                        custrecord_ctc_vc_bill_date: vclib_moment(billObj.date).toDate(),
                        custrecord_ctc_vc_bill_proc_status: 1,
                        custrecord_ctc_vc_bill_integration: configObj.id,
                        custrecord_ctc_vc_bill_src: billDataArr[i].xmlStr
                    };

                    var dueDate = null,
                        manualDueDate = false,
                        poNum = billObj.po.toString().trim();

                    if (billObj.hasOwnProperty('duedate')) {
                        dueDate = billObj.duedate;
                        manualDueDate = true;
                    }

                    var poData = arrPOData ? arrPOData[poNum] : null;

                    if (!poData) {
                        billFileNotes.push('PO Link is not found : [' + billObj.po + ']');
                    } else {
                        billFileValues['custrecord_ctc_vc_bill_linked_po'] = poData.id;
                        billFileNotes.push(
                            'Linked to PO: ' + poData.tranId + ' (' + poData.id + ') '
                        );

                        BillCFG = vcs_configLib.billVendorConfig({ poId: poData.id });
                        VendorCFG = vcs_configLib.orderVendorConfig({ poId: poData.id });

                        if (BillCFG && BillCFG.enableFulfillment) {
                            billFileValues['custrecord_ctc_vc_bill_is_recievable'] = true;
                        }

                        if (!manualDueDate) {
                            var dueDays = Helper.fetchVendorDueDate(poData.entityId);
                            if (dueDays !== null) {
                                dueDate = vclib_moment(billObj.date)
                                    .add(parseInt(dueDays), 'days')
                                    .format('MM/DD/YYYY');
                                billFileNotes.push(
                                    'Due date calculated based on vendor terms (' +
                                        dueDays +
                                        ' days)'
                                );
                            } else {
                                billFileNotes.push('No due date available');
                            }
                        } else {
                            billFileNotes.push('Due date provided by file');
                        }
                    }

                    if (dueDate !== null) {
                        billFileValues.custrecord_ctc_vc_bill_due_date =
                            vclib_moment(dueDate).toDate();
                        if (manualDueDate) {
                            billFileValues.custrecord_ctc_vc_bill_due_date_f_file = true;
                        }
                    }

                    if (poData && poData.id) {
                        var poLines = vcs_recordLib.searchTransactionLines({
                            recordId: poData.id,
                            recordType: 'purchaseorder',
                            columns: [
                                vc2_constant.GLOBAL.ITEM_ID_LOOKUP_COL,
                                vc2_constant.GLOBAL.VENDOR_SKU_LOOKUP_COL,
                                vc2_constant.FIELD.TRANSACTION.DH_MPN,
                                vc2_constant.FIELD.TRANSACTION.DELL_QUOTE_NO,
                                VendorCFG.itemColumnIdToMatch ||
                                    MainCFG.itemColumnIdToMatch ||
                                    'item',
                                VendorCFG.itemMPNColumnIdToMatch ||
                                    MainCFG.itemMPNColumnIdToMatch ||
                                    'item'
                            ]
                        });

                        var arrMatchedSKU = [];

                        billObj.lines.forEach(function (billFileLine) {
                            var vendorLine = vclib_utils.extend(billFileLine, {
                                ITEM_TEXT: billFileLine.ITEMNO || 'NA',
                                ITEM_ALT: billFileLine.ITEMNO_EXT || 'NA',
                                ITEM_SKU: billFileLine.ITEMNO_EXT || 'NA'
                            });

                            var matchedLine = null;

                            for (var ii = 0, jj = poLines.length; ii < jj; ii++) {
                                var poLine = poLines[ii];

                                var isMatched =
                                    vcs_itemMatchLib.isItemMatched({
                                        vendorLine: vendorLine,
                                        poLine: poLine,
                                        orderConfig: VendorCFG,
                                        mainConfig: MainCFG
                                    }) ||
                                    (function () {
                                        var listAltNames = vcs_itemMatchLib.fetchItemAltNames({
                                            orderLines: poLines,
                                            vendorConfig: VendorCFG,
                                            mainConfig: MainCFG
                                        });
                                        return vcs_itemMatchLib.isItemAltMatched({
                                            vendorLine: vendorLine,
                                            poLine: poLine,
                                            listAltNames: listAltNames,
                                            orderConfig: VendorCFG,
                                            mainConfig: MainCFG
                                        });
                                    })();

                                if (isMatched) {
                                    matchedLine = poLine;
                                    break;
                                }
                            }

                            if (!matchedLine) {
                                billFileNotes.push('Not matched SKU: ' + vendorLine.ITEMNO);
                            } else {
                                billFileLine.NSITEM = matchedLine.item;
                                billFileLine.ITEMNO =
                                    billFileLine.ITEMNO || matchedLine.item_text;
                                arrMatchedSKU.push(matchedLine.item);
                            }
                        });
                    } else {
                        for (var ii = 0; ii < billObj.lines.length; ii++) {
                            billObj.lines[ii].NSITEM = '';
                        }
                    }

                    billFileValues['custrecord_ctc_vc_bill_json'] = JSON.stringify(billObj);
                    billFileValues['custrecord_ctc_vc_bill_log'] = Helper.addNote({
                        note: billFileNotes.join(' | ')
                    });

                    var objRecord = ns_record.create({
                        type: 'customrecord_ctc_vc_bills',
                        isDynamic: true
                    });

                    for (var fieldId in billFileValues) {
                        objRecord.setValue({
                            fieldId: fieldId,
                            value: billFileValues[fieldId]
                        });
                    }

                    var recordId = objRecord.save();

                    vclib_utils.vcLog({
                        title: 'Bill File',
                        message:
                            'Created bill file | ' +
                            [recordId, billFileValues.name].join(' - '),
                        details: billFileValues,
                        status: vclib_constant.LIST.VC_LOG_STATUS.SUCCESS
                    });

                    vclib_utils.log(logTitle, '>> Bill File created: ' + recordId);
                    createdBillFiles.push(recordId);
                }

                returnValue = createdBillFiles;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        addNote: function (option) {
            return Helper.addNote(option);
        },
        addProcessLog: function (option) {
            var logTitle = [LogTitle, 'addProcessLog'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var billFileValues = option.billFileData || option.billFile,
                    billFileLogs = option.billFileLogs || option.processingLogs,
                    billFileId = option.billFileId || option.billId;

                if (!billFileLogs) {
                    billFileLogs =
                        (billFileValues && ns_util.isObject(billFileValues)
                            ? billFileValues[BILLFILE.FLD.PROCESS_LOG] ||
                              billFileValues.PROCESS_LOG
                            : false) ||
                        (billFileId
                            ? (function () {
                                  var billfileData = vclib_utils.flatLookup({
                                      type: BILLFILE.ID,
                                      id: billFileId,
                                      columns: [BILLFILE.FLD.PROCESS_LOG]
                                  });
                                  return billfileData[BILLFILE.FLD.PROCESS_LOG];
                              })()
                            : false);

                    if (!billFileLogs) throw 'Missing existing bill file logs';
                }

                returnValue = billFileLogs;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        linkPOItems: function (option) {
            var logTitle = [LogTitle, 'linkPOItems'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var poId = option.poId || option.po,
                    poNum = option.poNum,
                    billFileId = option.billfileId || option.billFile;

                if (!billFileId) throw { code: 'MISSING_PARAMETER', details: 'billFileId' };

                var billFileREC = ns_record.load({
                    type: BILLFILE.ID,
                    id: billFileId
                });
                if (!billFileREC) throw 'Missing Bill File Record: (id: ' + billFileId + ')';

                var billFileValues = {
                    JSON: billFileREC.getValue({ fieldId: BILLFILE.FIELD.JSON }),
                    PO_NUM: billFileREC.getValue({ fieldId: BILLFILE.FIELD.POID }),
                    PO_LINK: billFileREC.getValue({ fieldId: BILLFILE.FIELD.PO_LINK })
                };
                billFileValues.DATA = vclib_utils.safeParse(billFileValues.JSON);

                if (!poId || !poNum) {
                    poNum = billFileValues.PO_NUM;
                    poId = billFileValues.PO_LINK;
                }

                var updateValues = {};
                var poData = Helper.searchPO({ poId: poId, poNum: poNum });
                if (!poData) throw 'Unable to retrieve PO Link';

                var listItemsPO = Helper.collectItemsFromPO({ poId: poData.id });
                var keyVendorSKUMap = vc2_constant.GLOBAL.INCLUDE_ITEM_MAPPING_LOOKUP_KEY;

                for (var i = 0, j = billFileValues.DATA.lines.length; i < j; i++) {
                    var itemLine = billFileValues.DATA.lines[i];

                    var filterVendorName = {};
                    filterVendorName[keyVendorSKUMap] = function (values) {
                        return vclib_utils.inArray(itemLine.ITEMNO, values);
                    };

                    var matchingItem =
                        vclib_utils.findMatching({
                            list: listItemsPO,
                            filter: { itemNum: itemLine.ITEMNO }
                        }) ||
                        vclib_utils.findMatching({
                            list: listItemsPO,
                            filter: filterVendorName
                        });

                    if (
                        matchingItem &&
                        matchingItem.value &&
                        (!itemLine.NSITEM || itemLine.NSITEM != matchingItem.value)
                    ) {
                        if (itemLine.NSITEM) {
                            if (!itemLine.NSITEM_ORIG || itemLine.NSITEM_ORIG != itemLine.NSITEM) {
                                itemLine.NSITEM_ORIG = itemLine.NSITEM;
                            }
                        }
                        itemLine.NSITEM = matchingItem.value;
                    }
                }

                var billFileDataJSON = JSON.stringify(billFileValues.DATA);
                if (billFileDataJSON != billFileValues.JSON) {
                    updateValues[BILLFILE.FIELD.JSON] = billFileDataJSON;
                }

                if (!vclib_utils.isEmpty(updateValues)) {
                    returnValue = { updateValues: updateValues };
                    ns_record.submitFields({
                        type: BILLFILE.ID,
                        id: billFileId,
                        values: updateValues
                    });
                } else {
                    returnValue = { status: 'no-change' };
                }
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        collectItemsFromPO: function (option) {
            return Helper.collectItemsFromPO(option);
        },
        loadBillFile: function (option) {
            var logTitle = [LogTitle, 'loadBillFile'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var billFileRec = option.billFileRec || option.recBillFile,
                    billFileId = option.billFileId;

                if (!billFileRec) {
                    if (!billFileId) throw { code: 'MISSING_PARAMETER', details: 'billFileId' };
                    billFileRec = vcs_recordLib.load({
                        type: vc2_constant.RECORD.BILLFILE.ID,
                        id: billFileId
                    });
                    if (!billFileRec) throw 'Unable to load Bill File Record';
                }

                var billFileData = vcs_recordLib.extractValues({
                    record: billFileRec,
                    columns: vc2_constant.RECORD.BILLFILE.FIELD
                });

                billFileData.JSON = vclib_utils.safeParse(billFileData.JSON);
                billFileData.LINES = [];

                var nsItemNames = Helper.extractItemNames({
                    lines: (function () {
                        var nsItems = [];
                        if (billFileData.JSON && billFileData.JSON.lines) {
                            billFileData.JSON.lines.forEach(function (line) {
                                if (line.NSITEM) nsItems.push(line.NSITEM);
                            });
                        }
                        return nsItems;
                    })()
                });

                (billFileData.JSON.lines || []).forEach(function (jsonLine, idx) {
                    ['BILLRATE', 'RATE', 'PRICE'].forEach(function (field) {
                        if (jsonLine.hasOwnProperty(field)) {
                            jsonLine[field] = vclib_utils.forceFloat(jsonLine[field]);
                        }
                        return true;
                    });
                    jsonLine.QUANTITY = vclib_utils.forceInt(jsonLine.QUANTITY);
                    jsonLine.LINEIDX = idx;

                    ns_util.extend(jsonLine, {
                        quantity: jsonLine.QUANTITY,
                        itemId: (jsonLine.NSITEM || '').toString(),
                        rate: jsonLine.BILLRATE || jsonLine.PRICE,
                        item: (jsonLine.NSITEM || '').toString(),
                        itemName: jsonLine.ITEMNO,
                        description: jsonLine.DESCRIPTION,
                        NSITEM_NAME:
                            jsonLine.NSITEM && nsItemNames && nsItemNames[jsonLine.NSITEM]
                                ? nsItemNames[jsonLine.NSITEM].name
                                : ''
                    });

                    if (!jsonLine.ITEMNO && !jsonLine.PRICE) return;
                    if (!jsonLine.quantity) return;

                    billFileData.LINES.push(jsonLine);
                    return true;
                });

                billFileData.CHARGES = {};
                var charges = (billFileData.JSON && billFileData.JSON.charges) || {};
                ['shipping', 'other', 'tax'].forEach(function (chargeType) {
                    billFileData.CHARGES[chargeType] = vclib_utils.parseFloat(
                        charges[chargeType]
                    );
                    return true;
                });

                returnValue = billFileData;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        saveBillFile: function (option) {
            var logTitle = [LogTitle, 'saveBillFile'].join('::'),
                returnValue = null;

            option = option || {};

            try {
                var billFileData = option.billFileData || option.data,
                    billFileId = option.billFileId || option.id;

                if (!billFileData) throw { code: 'MISSING_PARAMETER', details: 'billFileData' };
                if (!billFileId) throw { code: 'MISSING_PARAMETER', details: 'billFileId' };

                ns_record.submitFields({
                    type: BILLFILE.ID,
                    id: billFileId,
                    values: billFileData
                });

                returnValue = billFileId;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        }
    };

    // collectItemsFromPO kept inside Helper but exposed via the library object
    Helper.collectItemsFromPO = function (option) {
        var logTitle = [LogTitle, 'collectItemsFromPO'].join('::'),
            returnValue = [];

        option = option || {};

        try {
            if (!option.poId) throw { code: 'MISSING_PARAMETER', details: 'poId' };

            if (!MainCFG) MainCFG = vcs_configLib.mainConfig();

            var poColumns = [
                ns_search.createColumn({ name: 'item', summary: 'GROUP' })
            ];

            var itemAltSKUColId = (VendorCFG && VendorCFG.itemColumnIdToMatch) ||
                    (MainCFG && MainCFG.itemColumnIdToMatch) || null,
                itemAltMPNColId = (VendorCFG && VendorCFG.itemMPNColumnIdToMatch) ||
                    (MainCFG && MainCFG.itemMPNColumnIdToMatch) || null;

            if (itemAltSKUColId) {
                itemAltSKUColId =
                    vc2_constant.FIELD_TO_SEARCH_COLUMN_MAP.TRANSACTION[itemAltSKUColId] ||
                    itemAltSKUColId;
                poColumns.push(
                    ns_search.createColumn({ name: itemAltSKUColId, summary: 'GROUP' })
                );
            }
            if (itemAltMPNColId) {
                itemAltMPNColId =
                    vc2_constant.FIELD_TO_SEARCH_COLUMN_MAP.TRANSACTION[itemAltMPNColId] ||
                    itemAltMPNColId;
                poColumns.push(
                    ns_search.createColumn({ name: itemAltMPNColId, summary: 'GROUP' })
                );
            }

            var itemSearch = ns_search.create({
                type: 'transaction',
                filters: [
                    ['internalid', 'anyof', option.poId],
                    'AND',
                    ['mainline', 'is', 'F']
                ],
                columns: poColumns
            });

            var arrSKUs = [],
                arrPOItems = [];

            itemSearch.run().each(function (result) {
                var skuData = {
                    text: result.getText({ name: 'item', summary: 'GROUP' }),
                    itemNum: result.getText({ name: 'item', summary: 'GROUP' }),
                    value: result.getValue({ name: 'item', summary: 'GROUP' }),
                    item: result.getValue({ name: 'item', summary: 'GROUP' })
                };
                arrSKUs.push(skuData);
                if (!vclib_utils.inArray(skuData.value, arrPOItems)) {
                    arrPOItems.push(skuData.value);
                }
                return true;
            });

            var arrSKUVendorNames = Helper.extractVendorItemNames(arrPOItems);
            if (arrSKUVendorNames && !vclib_utils.isEmpty(arrSKUVendorNames)) {
                var skuMapKey = vc2_constant.GLOBAL.INCLUDE_ITEM_MAPPING_LOOKUP_KEY;
                arrSKUs.forEach(function (skuData) {
                    if (arrSKUVendorNames[skuData.value]) {
                        skuData[skuMapKey] = arrSKUVendorNames[skuData.value];
                    }
                    return true;
                });
            }

            returnValue = arrSKUs;
        } catch (error) {
            vclib_error.log(logTitle, error, ERROR_LIST);
            returnValue = false;
        }

        return returnValue;
    };

    return BillFileCreateLib;
});
