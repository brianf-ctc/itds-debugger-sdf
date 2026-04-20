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
 * Script Name: CTC VC | Generate Bills RL
 * Script ID: customscript_vc_bill_creator_restlet
 * @author brianf@nscatalyst.com
 * @description Bill Creator Restlet that processes a single vendor bill file and generates Vendor Bills.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-04-20   brianf        CST-5022: Added explicit format array and strict mode to 3 unsafe moment() calls (trandate, fulfillDate, duedate) to prevent date corruption
 * 2026-03-28   brianf        Added id field to success response for MR BILL_LINK mapping; added isError and status to
 *                              validateBill early-return so MR catch block fires correctly
 * 2026-03-25   brianf        Refined bill save/return handling, aligned fulfill-date and validation logging, and removed the
 *                              unused legacy record import
 * 2026-03-14   brianf        Normalized ctc_lib_error import to explicit .js path while retaining existing ctc_lib_utils/ctc_lib_error
 *                              usage and no ctc_lib_return dependency
 * 2026-03-13   brianf        Updated Restlet to align with BillProcess refactor: switched util.extend calls to ns_util.extend via
 *                              N/util import, fixed reportError variance key usage, and made misc charge validation compatible with
 *                              ChargesDEF.miscCharges
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType Restlet
 */
define(function (require) {
    var ns_record = require('N/record'),
        ns_search = require('N/search'),
        ns_format = require('N/format'),
        ns_runtime = require('N/runtime'),
        ns_util = require('N/util');

    var vc_billprocess = require('./Libraries/CTC_VC_Lib_BillProcess'),
        vc2_constant = require('./../CTC_VC2_Constants'),
        vc2_util = require('./../CTC_VC2_Lib_Utils');

    var vcs_configLib = require('./../Services/ctc_svclib_configlib'),
        vcs_recordLib = require('./../Services/ctc_svclib_records'),
        vcs_processLib = require('./../Services/ctc_svclib_process-v1');

    var vclib_error = require('./../Services/lib/ctc_lib_error.js'),
        moment = require('./Libraries/moment');
    var LogTitle = 'VC BILL CREATE RL',
        VCLOG_APPNAME = 'VAR Connect | Process Bill',
        Current = { MainCFG: {} },
        LogPrefix = '',
        BILLPROC = {},
        BILL_CREATOR = vc2_constant.Bill_Creator;

    var RESTLET = {
        post: function (context) {
            var logTitle = [LogTitle, 'POST'].join('::'),
                returnObj = {};

            vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

            try {
                vc2_util.log(logTitle, '###########################################');
                vc2_util.log(logTitle, '### Request: ', context);

                var currentScript = ns_runtime.getCurrentScript();

                ns_util.extend(Current, {
                    poId: context.PO_LINK,
                    billFileId: context.ID,
                    billInAdvance: context.billInAdvance || false,
                    processVariance: context.PROC_VARIANCE || false,
                    poVendor: context.entity,
                    invoiceNo: context.invoiceNo
                });

                /// FIND EXISTING BILLS =================
                vc2_util.log(logTitle, '// Checking for existing bills...');
                var arrExistingBills = vc_billprocess.searchExistingBills({
                    entity: Current.poVendor,
                    invoiceNo: Current.invoiceNo
                });

                /// BILL ALREADY EXISTS //////////////////////
                if (arrExistingBills && arrExistingBills.length) {
                    var billRec = ns_record.load({
                        type: 'vendorbill',
                        id: arrExistingBills[0]
                    });

                    ns_util.extend(returnObj, JSON.parse(JSON.stringify(billRec)));
                    returnObj.existingBills = JSON.stringify(arrExistingBills);
                    returnObj.details =
                        'Linked to existing bill (id:' + arrExistingBills[0] + ' ). ';
                    ns_util.extend(returnObj, BILL_CREATOR.Code.EXISTING_BILLS);

                    return returnObj;
                }
                /// =====================================

                /// PRE PROCESS THE BILL ////
                BILLPROC = vc_billprocess.preprocessBill({
                    billFileId: Current.billFileId,
                    poId: Current.poId
                });

                // ns_util.extend(returnObj, {
                //     requestData: vc2_util.clone(Current),
                //     processedData: {
                //         PO_DATA: BILLPROC.PO.DATA,
                //         STATUS: BILLPROC.STATUS,
                //         TOTAL: BILLPROC.TOTAL,
                //         ErrorList: BILLPROC.ErrorList,
                //         VarianceList: BILLPROC.VarianceList,
                //         Variances: BILLPROC.Variances
                //     }
                // });
                /// PRE PROCESS THE BILL ////

                /// CHECK FOR VARIANCE AMOUNT, and update the BILL FILE //
                if (BILLPROC.BILLFILE.DATA.VARAMT != BILLPROC.TOTAL.VARIANCE) {
                    ns_util.extend(returnObj, {
                        varianceAmount: vc2_util.parseFloat(BILLPROC.TOTAL.VARIANCE)
                    });
                }

                if (!Current.poId) {
                    returnObj.details = ' PO ID:' + Current.poId + ' is missing or inactive.';
                    throw BILL_CREATOR.Code.MISSING_PO;
                }
                LogPrefix = '[purchaseorder:' + Current.poId + '] ';
                vc2_util.LogPrefix = LogPrefix;

                // Load the PO Record
                Current.PO_REC = BILLPROC.PO.REC;
                Current.PO_DATA = BILLPROC.PO.DATA;
                Current.MainCFG = BILLPROC.CFG.MainCFG;
                Current.BillCFG = BILLPROC.CFG.BillCFG;
                Current.OrderCFG = BILLPROC.CFG.OrderCFG;
                Current.ignoreVariance = BILLPROC.STATUS.BILLFILE.IgnoreVariance;

                /// CHECK if the items are fully billed //
                if (BILLPROC.STATUS.BILLFILE.ItemsAllBilled) {
                    vc2_util.log(logTitle, '>> All items are already billed.');
                    return ns_util.extend(returnObj, BILL_CREATOR.Code.ITEMS_ALREADY_BILLED);
                }

                /// CHECK FOR ERRORS  ///
                if (
                    BILLPROC.STATUS.HasErrors &&
                    !(
                        BILLPROC.STATUS.BILLFILE.AllowVariance ||
                        BILLPROC.STATUS.BILLFILE.IgnoreVariance
                    )
                ) {
                    vc2_util.log(logTitle, '-- Errors Detected: ', BILLPROC.ErrorList);

                    var errorCode = BILLPROC.ErrorList.shift();
                    return ns_util.extend(
                        returnObj,
                        BILL_CREATOR.Code[errorCode] || { msg: 'Unexpected error' }
                    );
                }

                /// CHECK FOR VARIANCE  ///
                if (
                    !BILLPROC.STATUS.AllowToBill &&
                    BILLPROC.STATUS.HasVariance &&
                    !(
                        BILLPROC.STATUS.BILLFILE.AllowVariance ||
                        BILLPROC.STATUS.BILLFILE.IgnoreVariance
                    )
                ) {
                    var errorReport = vc_billprocess.reportError();
                    var errorMsg = [];

                    if (errorReport.errors.length > 0) errorMsg.push(errorReport.errors.join(', '));
                    if (errorReport.variance.length > 0)
                        errorMsg.push(errorReport.variance.join(', '));
                    if (errorReport.notes.length > 0) errorMsg.push(errorReport.notes.join(', '));

                    vc2_util.log(logTitle, '-- Error Detected: ', errorReport);

                    return ns_util.extend(
                        ns_util.extend(returnObj, {
                            details: errorMsg.join('\n')
                        }),
                        BILL_CREATOR.Code.HAS_VARIANCE
                    );
                }
                // /// STATUS CHECK ========================
                if (
                    !BILLPROC.STATUS.AllowToBill &&
                    !Current.billInAdvance &&
                    !(
                        BILLPROC.STATUS.BILLFILE.AllowVariance ||
                        BILLPROC.STATUS.BILLFILE.IgnoreVariance
                    )
                ) {
                    return ns_util.extend(returnObj, BILL_CREATOR.Code.NOT_BILLABLE);
                }

                /// PROCESS THE BILL  =================
                vc2_util.log(logTitle, '/// BILL PROCESS STATUS', BILLPROC.STATUS);
                vc2_util.log(logTitle, '/// PO DATA', BILLPROC.PO.DATA);

                /// =====================================

                /// CHECK IF BILL CREATION IS DISABLED //
                if (BILLPROC.CFG.MainCFG.isBillCreationDisabled) {
                    ns_util.extend(returnObj, BILL_CREATOR.Code.BILL_CREATE_DISABLED);
                    return returnObj;
                }

                /// START BILL CREATE  ==================
                // Get sales order details
                vc2_util.log(logTitle, '**** START: Vendor Bill Creation *****');

                Current.SO_DATA = Helper.getSalesOrderDetails({ poId: BILLPROC.PO.ID });
                vc2_util.log(logTitle, '... SO Data: ', Current.SO_DATA);

                /// SET POSTING PERIOD
                var currentPostingPeriod = BILLPROC.BILL.REC
                    ? BILLPROC.BILL.REC.getValue({ fieldId: 'postingperiod' })
                    : null;
                vc2_util.log(logTitle, '>> posting period: ', currentPostingPeriod);

                var updateBillValues = {
                    /// Set INVOICE NAME
                    tranid: BILLPROC.BILLFILE.JSON.invoice,
                    /// SET the trandate
                    trandate: ns_format.parse({
                        value: moment(BILLPROC.BILLFILE.JSON.date, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(), // [ CodeMaster ] CST-5022: explicit format array + strict mode
                        type: ns_format.Type.DATE
                    }),
                    custbody_ctc_vc_createdby_vc: true,
                    approvalstatus: BILLPROC.CFG.MainCFG.defaultVendorBillStatus || 1
                };

                if (Current.BillCFG.useFulfillDate) {
                    var fulfillDate = Helper.detectFulfillDate({
                        invoiceId: BILLPROC.BILLFILE.JSON.invoice,
                        orderConfig: Current.OrderCFG,
                        poId: Current.poId
                    });
                    vc2_util.log(logTitle, ' *** USE FULFILL DATE *** ', fulfillDate);

                    if (fulfillDate) {
                        updateBillValues.trandate = ns_format.parse({
                            value: moment(fulfillDate, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(), // [ CodeMaster ] CST-5022: explicit format array + strict mode
                            type: ns_format.Type.DATE
                        });
                    }
                }

                /// SET DUE DATE
                if (BILLPROC.BILLFILE.DATA.DUEDATE) {
                    updateBillValues.duedate = ns_format.parse({
                        value: moment(BILLPROC.BILLFILE.DATA.DUEDATE, ['MM/DD/YYYY', 'YYYY-MM-DD', moment.ISO_8601], true).toDate(), // [ CodeMaster ] CST-5022: explicit format array + strict mode
                        type: ns_format.Type.DATE
                    });
                }

                vc2_util.log(logTitle, '*** VALUES *** ', updateBillValues);

                // update the values
                vcs_recordLib.setValues({ record: BILLPROC.BILL.REC, values: updateBillValues });

                /// SET POSTING PERIOD
                var isPeriodLocked = Helper.isPeriodLocked({ recordBill: BILLPROC.BILL.REC });
                if (isPeriodLocked) {
                    vc2_util.log(logTitle, ' *** PERIOD LOCKED *** ');
                    // set to original period
                    vcs_recordLib.setValues({
                        record: BILLPROC.BILL.REC,
                        values: {
                            postingperiod: BILLPROC.PO.DATA.postingperiod
                        }
                    });
                }

                // validate the bill
                var billValidation = Helper.validateBill({
                    recordBill: BILLPROC.BILL.REC,
                    billFileLines: BILLPROC.BILLFILE.LINES
                });

                if (billValidation.hasError) {
                    ns_util.extend(returnObj, billValidation);
                    return returnObj;
                }

                /// SAVING THE BILL =====================

                var saveRecordOption = { enableSourcing: true, ignoreMandatoryFields: true };
                vc2_util.log(logTitle, '**** SAVING Bill Record *** ', saveRecordOption);

                try {
                    returnObj.newBillId = BILLPROC.BILL.REC.save(saveRecordOption);
                    vc2_util.log(
                        logTitle,
                        '... bill created successfully: ',
                        [BILLPROC.BILL.REC.type, returnObj.newBillId].join(':')
                    );

                    vc2_util.vcLog({
                        title: 'Process Bill | Created',
                        successMsg: vc2_util.printSuccessLog({
                            recordType: 'Vendor Bill',
                            recordId: returnObj.newBillId // corrected from ffresult.id to ffResult.id
                        }),
                        recordId: Current.poId
                    });
                } catch (saveRecordError) {
                    var saveRecErrorObj = vclib_error.interpret(saveRecordError);

                    if (returnObj.newBillId) {
                        vc2_util.log(logTitle, '[WARNING]... created the bill but with errors: ', [
                            [BILLPROC.BILL.REC.type, returnObj.newBillId].join(':'),
                            saveRecErrorObj.message
                        ]);

                        vc2_util.vcLog({
                            title: 'Process Bill | Warning',
                            warning: 'Created but with errors: ' + saveRecErrorObj.message,
                            recordId: Current.poId
                        });
                    } else {
                        vclib_error.log(logTitle, saveRecErrorObj);
                        throw saveRecErrorObj.message;
                    }
                }

                if (!vc2_util.isEmpty(BILLPROC.Serials)) {
                    vc2_util.log(logTitle, '*** PROCESSING serials ***', BILLPROC.Serials);

                    BILLPROC.Serials.forEach(function (serialData) {
                        var remUsage = ns_runtime.getCurrentScript().getRemainingUsage();

                        if (remUsage > 500) {
                            vcs_processLib.processSerials(serialData);
                        } else {
                            vc2_util.serviceRequest({
                                moduleName: 'processV1',
                                action: 'processSerials',
                                parameters: serialData
                            });
                        }
                    });
                }

                // update our returnObj with stable primitive fields instead of serializing the record
                ns_util.extend(returnObj, {
                    id: returnObj.newBillId,
                    recordType: BILLPROC.BILL.REC && BILLPROC.BILL.REC.type,
                    billId: returnObj.newBillId,
                    invoiceNumber:
                        BILLPROC.BILLFILE &&
                        BILLPROC.BILLFILE.DATA &&
                        BILLPROC.BILLFILE.DATA.invoice
                });
                ns_util.extend(returnObj, BILL_CREATOR.Code.BILL_CREATED);
                returnObj.details =
                    'Linked to vendor bill ' +
                    JSON.stringify({
                        id: returnObj.newBillId,
                        name:
                            BILLPROC.BILLFILE &&
                            BILLPROC.BILLFILE.DATA &&
                            BILLPROC.BILLFILE.DATA.invoice
                    });
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                util.extend(returnObj, {
                    msg: errorObj.message || 'Error processing bill',
                    details: returnObj.details || errorObj.detail,
                    status: error.status || BILL_CREATOR.Status.ERROR,
                    isError: true
                });
                if (error.logstatus) returnObj.logstatus = error.logstatus;
                returnObj.msg = [
                    returnObj.msg,
                    returnObj.details != returnObj.msg ? returnObj.details : ''
                ].join(' ');

                vc2_util.vcLog({
                    title: 'Process Bill | Error',
                    error: returnObj.msg,
                    recordId: Current.poId
                });
            } finally {
                vc2_util.log(logTitle, '## EXIT SCRIPT ## ', returnObj);
            }

            return returnObj;
        }
    };

    var Helper = {
        getExistingBill: function (option) {
            var logTitle = [LogTitle, 'getExistingBill'].join('::'),
                returnValue;
            option = option || {};
            var arrExistingBills = [];

            var vendorbillSearchObj = ns_search.create({
                type: 'vendorbill',
                filters: [
                    ['type', 'anyof', 'VendBill'],
                    'AND',
                    ['mainname', 'anyof', option.entity],
                    'AND',
                    ['numbertext', 'is', option.invoiceNo],
                    'AND',
                    ['mainline', 'is', 'T']
                ],
                columns: ['internalid']
            });

            vendorbillSearchObj.run().each(function (result) {
                arrExistingBills.push(result.getValue('internalid'));
                return true;
            });

            // vc2_util.log(logTitle, '>> Existing Bill: ', arrExistingBills || '-none-');
            returnValue = arrExistingBills;

            return returnValue;
        },
        getSalesOrderDetails: function (option) {
            var logTitle = [LogTitle, 'getSalesOrderDetails'].join('::'),
                returnValue;
            option = option || {};
            var poId = option.poId;
            if (poId) {
                var poDetails = ns_search.lookupFields({
                    type: 'transaction',
                    id: poId,
                    columns: ['createdfrom.entity']
                });
                var multiselectFields = ['createdfrom.entity'];
                var soDetails = {};
                for (var field in poDetails) {
                    var soFieldName = field;
                    if (field.indexOf('createdfrom.') == 0) {
                        soFieldName = field.substr(12);
                    }
                    if (
                        multiselectFields.indexOf(field) >= 0 &&
                        poDetails[field] &&
                        poDetails[field][0] &&
                        poDetails[field][0].value
                    ) {
                        soDetails[soFieldName] = poDetails[field][0].value;
                    } else {
                        soDetails[soFieldName] = poDetails[field];
                    }
                }

                vc2_util.log(logTitle, '... PO Details: ', poDetails);
                vc2_util.log(logTitle, '... SO Details: ', soDetails);

                returnValue = soDetails;
            }
            return returnValue;
        },
        isPeriodLocked: function (option) {
            var logTitle = [LogTitle, 'isPeriodLocked'].join('::'),
                returnValue;
            option = option || {};

            var recBill = option.recordBill;
            var isLocked = false;
            var periodValues = ns_search.lookupFields({
                type: ns_search.Type.ACCOUNTING_PERIOD,
                id: recBill.getValue({ fieldId: 'postingperiod' }),
                columns: ['aplocked', 'alllocked', 'closed']
            });

            isLocked = periodValues.aplocked || periodValues.alllocked || periodValues.closed;
            vc2_util.log(logTitle, '>> isPeriodLocked? ', isLocked);
            returnValue = isLocked;

            return returnValue;
        },
        detectFulfillDate: function (option) {
            var logTitle = [LogTitle, 'detectFulfillDate'].join('::'),
                returnValue;
            option = option || {};

            var invoiceId = option.invoiceId,
                orderConfig = option.orderConfig,
                poId = option.poId,
                fulfillDate = null;

            try {
                var searchOption = {
                    type: 'transaction',
                    filters: [
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['appliedtotransaction', 'anyof', poId],
                        'AND',
                        [
                            "formulatext: REGEXP_REPLACE({custbody_ctc_if_vendor_order_match}, '[^a-zA-Z0-9]', '')",
                            'contains',
                            invoiceId.replace(/[^a-zA-Z0-9]/g, '')
                        ]
                    ],
                    columns: ['internalid', 'trandate', 'custbody_ctc_if_vendor_order_match']
                };
                vc2_util.log(logTitle, '>> searchOption: ', searchOption);
                var itemffSearch = ns_search.create(searchOption);
                if (!itemffSearch.runPaged().count) throw 'No item fulfillment found';

                itemffSearch.run().each(function (result) {
                    fulfillDate = result.getValue('trandate');
                    return true;
                });

                returnValue = fulfillDate;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            } finally {
                vc2_util.log(logTitle, '>> fulfillDate: ', returnValue);
            }

            return returnValue;
        },
        validateBill: function (option) {
            var logTitle = [LogTitle, 'validateBill'].join('::'),
                returnValue = {};
            option = option || {};

            var errorList = [];

            try {
                var recordBill = option.recordBill || BILLPROC.BILL.REC,
                    billFileLines = option.billFileLines || BILLPROC.BILLFILE.LINES;

                // first validate the bill lines
                var arrVBLines = vcs_recordLib.extractLineValues({
                    record: recordBill,
                    sublistId: 'item',
                    additionalColumns: [
                        'line',
                        'item',
                        'itemname',
                        'quantity',
                        'poline',
                        'orderline',
                        'orderdoc',
                        'location'
                    ]
                });

                var arrAppliedLines = [];
                billFileLines.forEach(function (billFileLine) {
                    if (!billFileLine.MATCHING) return;
                    billFileLine.MATCHING.forEach(function (poLine) {
                        arrAppliedLines.push(poLine);
                    });
                });

                var ChargesDEF = BILLPROC.CFG.ChargesDEF,
                    ChargesShipping = ChargesDEF && ChargesDEF.shipping,
                    ChargesMisc = ChargesDEF && (ChargesDEF.miscCharges || ChargesDEF.misc),
                    ChargesShippingEnabled =
                        ChargesShipping && ChargesShipping.enabled && ChargesShipping.applied,
                    ChargesMiscEnabled = ChargesMisc && ChargesMisc.enabled && ChargesMisc.applied;

                arrVBLines.forEach(function (vbLine, lineIdx) {
                    try {
                        var lineItemText = (vbLine.item_text || '').toString(),
                            isShippingLine =
                                /shipping|freight/i.test(lineItemText) ||
                                (ChargesShipping &&
                                    ChargesShipping.item &&
                                    ChargesShipping.item == vbLine.item),
                            isMiscChargeLine =
                                ChargesMisc && ChargesMisc.item && ChargesMisc.item == vbLine.item,
                            isValidPOLine = vbLine.orderdoc && vbLine.orderdoc == BILLPROC.PO.ID;

                        if (isShippingLine) {
                            if (!ChargesShippingEnabled) throw 'Shipping is not enabled/applied';
                            return;
                        }

                        if (isMiscChargeLine) {
                            if (!ChargesMiscEnabled)
                                throw 'Misc Charges line is not enabled/applied';
                            return;
                        }

                        if (!isValidPOLine) {
                            throw 'Invalid PO Line';
                        }

                        var appliedBillLine = arrAppliedLines.filter(function (appliedLine) {
                            return (
                                (appliedLine.orderline === vbLine.orderline ||
                                    appliedLine.line === vbLine.line) &&
                                appliedLine.item_text === vbLine.item_text
                            );
                        });

                        if (vc2_util.isEmpty(appliedBillLine)) {
                            throw (
                                'No matching vendor line found for PO line: ' +
                                [vbLine.orderline, vbLine.item_text].join('|')
                            );
                        }
                        appliedBillLine = appliedBillLine[0];

                        if (vbLine.quantity != appliedBillLine.APPLIEDQTY) {
                            vcs_recordLib.updateLineValues({
                                record: recordBill,
                                sublistId: 'item',
                                line: lineIdx,
                                lineValues: {
                                    quantity: appliedBillLine.APPLIEDQTY
                                }
                            });
                        }
                    } catch (vblineError) {
                        var errorMsg = vclib_error.interpret(vblineError);

                        errorList.push(
                            [
                                errorMsg.message,
                                [
                                    'Line #' + vbLine.line,
                                    'Item: ' + vbLine.itemname,
                                    'PO ID: ' + vbLine.orderdoc
                                ].join(' | ')
                            ].join(': ')
                        );
                    }
                });

                if (!BILLPROC.STATUS.HasVariance) {
                    // check the bill total
                    var billFileTotal = vc2_util.parseFloat(BILLPROC.BILLFILE.JSON.total || '0'),
                        billRecTotal = vc2_util.parseFloat(
                            BILLPROC.BILL.REC.getValue({ fieldId: 'total' }) || '0'
                        ),
                        diffAmountThreshold =
                            BILLPROC.CFG.MainCFG.allowedVarianceAmountThreshold || 0.01,
                        billTotalDiff = vc2_util.roundOff(Math.abs(billFileTotal - billRecTotal));

                    vc2_util.log(logTitle, '>> Totals / Threshold: ', [
                        billFileTotal,
                        billRecTotal,
                        diffAmountThreshold
                    ]);

                    if (billTotalDiff > diffAmountThreshold) {
                        errorList.push(
                            'Bill total mismatch: File Total: ' +
                                (billFileTotal + ', Record Total: ' + billRecTotal)
                        );
                    }
                }

                /// CHECK for Errors ////
                if (errorList.length) {
                    vc2_util.log(logTitle, '**** BILL VALIDATION ERRORS FOUND ****', errorList);

                    // make it unique
                    errorList = vc2_util.uniqueArray(errorList);
                    return ns_util.extend(returnValue, {
                        hasError: true,
                        isError: true,
                        msg: 'Bill Validation Error',
                        details: errorList.join('\n'),
                        status: BILL_CREATOR.Status.ERROR
                    });
                }
            } catch (error) {
                vclib_error.log(logTitle, error);
            } finally {
                vc2_util.log(logTitle, '>> returnValue: ', returnValue);
            }

            return returnValue;
        }
    };

    return RESTLET;
});
