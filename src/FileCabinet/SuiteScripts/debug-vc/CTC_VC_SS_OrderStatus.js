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
 * Script Name: CTC VC | Process Order Status SS
 * Script ID: customscript_ctc_vc_proc_orderstat
 *
 * @author brianf@nscatalyst.com
 * @description Scheduled script to poll a single PO for vendor order status and update related
 *   POs, IFs, IRs, and serial numbers. All processing logic is inline with straight sequential
 *   execution.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Fixed Current.MainCFG/OrderCFG refs; fixed orderData.VendorOrderNum scope in processItemFulfillment; replaced vendorLines IIFE
 *                            with mapVendorLineCols; added mapVendorLineCols+EXCEED_LINE_LIMIT gate to processItemReceipt; added try/catch to
 *                            mapVendorLineCols; reset EXCEED_LINE_LIMIT in execute; fixed date extraction to use first non-null value; removed
 *                            OrderStatusLib dependency and phased execution
 * 2026-03-26   brianf        Refactored to delegate all phase logic to OrderStatusLib service
 * 2026-03-20   brianf        Initial build.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType ScheduledScript
 */
define(function (require) {
    var ns_record = require('N/record'),
        ns_runtime = require('N/runtime');

    var vc2_constant = require('./CTC_VC2_Constants.js');

    var vclib_utils = require('./Services/lib/ctc_lib_utils.js'),
        vclib_constant = require('./Services/lib/ctc_lib_constants.js'),
        vclib_error = require('./Services/lib/ctc_lib_error.js');

    var vcs_recordsLib = require('./Services/ctc_svclib_records.js'),
        vcs_txnLib = require('./Services/ctc_svclib_transaction.js'),
        vcs_configLib = require('./Services/ctc_svclib_configlib.js'),
        vcs_processLib = require('./Services/ctc_svclib_process-v1.js'),
        vcs_websvcLib = require('./Services/ctc_svclib_webservice.js');

    var LogTitle = 'SS_OrderStatus',
        VCLOG_APPNAME = vclib_constant.APPNAME.ORDER_STATUS;

    var ERROR_MSG = vclib_constant.ERROR_MSG,
        LOG_STATUS = vclib_constant.LIST.VC_LOG_STATUS;

    var PO_COLS = {
        poNum: 'tranid',
        tranDate: 'trandate',
        vendorId: 'entity',
        createdFrom: 'createdfrom',
        poLinkType: 'custbody_ctc_po_link_type',
        isDropShip: 'custbody_isdropshippo',
        isBypassVC: 'custbody_ctc_bypass_vc',
        subsidiary: vclib_constant.GLOBAL.ENABLE_SUBSIDIARIES ? 'subsidiary' : null,
        overridePO: vclib_constant.FIELD.TRANSACTION.OVERRIDE_PONUM
    };

    var VENDOR_LINE_MAP = {
        order_num: 'ORDER_NUM',
        order_status: 'ORDER_STATUS',
        order_date: 'ORDER_DATE',
        ship_date: 'SHIP_DATE',
        order_eta: 'ORDER_ETA',
        deliv_eta: 'DELIV_ETA',
        deliv_date: 'DELIV_DATE',
        item_num: 'ITEM_TEXT',
        item_num_alt: 'ITEM_ALT',
        carrier: 'CARRIER',
        tracking_num: 'TRACKING_NUMS',
        serial_num: 'SERIAL_NUMS',
        ship_qty: 'QUANTITY',
        is_shipped: 'IS_SHIPPED'
    };
    var LINE_COUNT_MAX = 800,
        EXCEED_LINE_LIMIT = false;

    var Endpoint = {
        /**
         * @function execute
         * @description Main entry point. Processes a single PO: calls vendor API, updates PO,
         *   creates fulfillments/receipts, and processes serial numbers.
         * @param {Object} context - Execution context from NetSuite
         * @returns {boolean}
         */
        execute: function (context) {
            var logTitle = [LogTitle, 'execute'].join('::');
            vclib_constant.LOG_APPLICATION = VCLOG_APPNAME;

            var Current = {};
            var PO_REC, SO_REC, MainCFG, OrderCFG;
            var orderStatusObj,
                fulfillmentResponse = {};

            // Reset module-level flag to prevent stale state across invocations
            EXCEED_LINE_LIMIT = false;

            try {
                vclib_utils.logDebug(logTitle, '###### START OF SCRIPT ######');

                var currentScript = ns_runtime.getCurrentScript();
                var param = {
                    poId: currentScript.getParameter('custscript_ctcvc_orderstat_poid'),
                    poNum: currentScript.getParameter('custscript_ctcvc_orderstat_ponum')
                };

                vclib_utils.logDebug(logTitle, '... Parameters: ', param);

                // ======== RESOLVE PO ========
                if (!param.poId && param.poNum) {
                    var poData = vcs_recordsLib.searchTransaction({
                        tranid: param.poNum,
                        type: 'purchaseorder'
                    });
                    if (poData) {
                        param.poId = poData.id;
                        vclib_utils.logDebug(logTitle, '... Resolved PO ID: ', param.poId);
                    } else {
                        throw util.extend(ERROR_MSG.MISSING_PO, {
                            detail: 'PO Number not found: ' + param.poNum
                        });
                    }
                }
                if (!param.poId) throw ERROR_MSG.MISSING_PO;

                // ======== VALIDATE LICENSE & CONFIG ========
                var license = vcs_configLib.validateLicense();
                if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

                MainCFG = vcs_configLib.mainConfig();
                if (!MainCFG) throw ERROR_MSG.MISSING_CONFIG;
                if (!MainCFG.processDropships && !MainCFG.processSpecialOrders)
                    throw ERROR_MSG.NO_PROCESS_DROPSHIP_SPECIALORD;

                var LogPrefix = '[purchaseorder:' + param.poId + '] ';
                vclib_utils.LogPrefix = LogPrefix;

                // ======== LOAD PO ========
                Current.poId = param.poId;

                PO_REC = vcs_recordsLib.load({
                    type: 'purchaseorder',
                    id: param.poId,
                    isDynamic: true
                });

                util.extend(
                    Current,
                    vcs_recordsLib.extractValues({
                        record: PO_REC,
                        columns: PO_COLS
                    }) || { error: 'Unable to extract values' }
                );

                // get the line count
                Current.lineCount = vcs_recordsLib.getLineCount({ id: param.poId });
                if (Current.lineCount >= LINE_COUNT_MAX) EXCEED_LINE_LIMIT = true;

                vclib_utils.logDebug(logTitle, '... Current PO: ', Current);
                if (vclib_utils.isTrue(Current.isBypassVC)) throw ERROR_MSG.BYPASS_VARCONNECT;

                // ======== LOAD VENDOR CONFIG ========
                OrderCFG = vcs_configLib.orderVendorConfig({ poId: Current.poId });
                if (!OrderCFG) throw ERROR_MSG.MISSING_VENDORCFG;

                if (MainCFG.overridePONum && Current.overridePO) {
                    Current.poNum = Current.overridePO;
                    vclib_utils.logDebug(
                        logTitle,
                        '**** TEMP PO NUM: ' + Current.overridePO + ' ****'
                    );
                }

                // ======== CALL VENDOR API ========
                orderStatusObj = vcs_websvcLib.OrderStatus({
                    poNum: Current.poNum,
                    poId: Current.poId
                });

                vclib_utils.vcLog({
                    title: 'SS Order Status | Output',
                    recordId: Current.poId,
                    message: vclib_utils.extractError(orderStatusObj.Lines)
                });

                if (orderStatusObj.hasError) throw orderStatusObj.message;
                if (
                    vclib_utils.isEmpty(orderStatusObj.Orders) ||
                    vclib_utils.isEmpty(orderStatusObj.Lines)
                ) {
                    throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                        details: orderStatusObj.message || 'No lines to process'
                    });
                }

                var orderStatusSummary = Helper.buildStatusSummary(orderStatusObj.Orders);

                vclib_utils.logDebug(logTitle, '/// Order Data: ', {
                    Orders: orderStatusObj.Orders.length,
                    Lines: orderStatusObj.Lines.length,
                    summary: orderStatusSummary
                });

                // ======== COMMON SETUP ========
                Current.isDropPO =
                    PO_REC.getValue({ fieldId: 'dropshipso' }) ||
                    PO_REC.getValue({ fieldId: 'custbody_ctc_po_link_type' }) == 'Drop Shipment' ||
                    PO_REC.getValue({ fieldId: 'custbody_isdropshippo' });

                SO_REC = vcs_recordsLib.load({ type: 'salesorder', id: Current.createdFrom });

                if (!SO_REC) throw ERROR_MSG.STANDALONE_PO;
                Current.customerId = SO_REC.getValue('entity');

                // ======== 1. PROCESS ORDER STATUS LINES ========
                // if (EXCEED_LINE_LIMIT) {
                //     vclib_utils.serviceRequest({
                //         moduleName: 'processV1',
                //         action: 'cleanupOrderStatusLines',
                //         parameters: { poId: Current.poId }
                //     });
                // } else {
                //     vcs_processLib.cleanupOrderStatusLines({ poId: Current.poId });
                // }
                vcs_processLib.cleanupOrderStatusLines({ poId: Current.poId });

                (orderStatusObj.Orders || []).forEach(function (OrderData) {
                    vclib_utils.logDebug(logTitle, '/// Processing Order: ', [
                        [OrderData.OrderNum, OrderData.Status].join(':'),
                        ['lines', (OrderData.Lines || []).length].join(':')
                    ]);

                    var processOption = util.extend(OrderData, {
                        ConfigRec: OrderCFG,
                        poId: Current.poId,
                        poNum: Current.poNum
                    });

                    if (EXCEED_LINE_LIMIT) {
                        vclib_utils.serviceRequest({
                            moduleName: 'processV1',
                            action: 'processOrderStatusLines',
                            parameters: processOption
                        });
                    } else {
                        vcs_processLib.processOrderStatusLines(processOption);
                    }
                });

                // ======== 2. UPDATE PO ========
                var updateResult = (function (updateOption) {
                    return EXCEED_LINE_LIMIT
                        ? vclib_utils.serviceRequest({
                              moduleName: 'transactionLib',
                              action: 'updatePurchaseOrder',
                              parameters: updateOption
                          })
                        : vcs_txnLib.updatePurchaseOrder(updateOption);
                })({
                    poId: Current.poId,
                    poRec: PO_REC,
                    mainConfig: MainCFG,
                    orderConfig: OrderCFG,
                    isDropShip: Current.isDropPO,
                    vendorLines: Helper.mapVendorLineCols(orderStatusObj.Lines),
                    doSave: true
                });

                ns_record.submitFields({
                    type: ns_record.Type.PURCHASE_ORDER,
                    id: Current.poId,
                    values: {
                        custbody_ctc_vc_order_status: orderStatusSummary
                    }
                });

                vclib_utils.logDebug(logTitle, '... PO Update Result: ', updateResult);

                orderStatusObj.Lines.forEach(function (vendorLine) {
                    var orderLine = vendorLine.MATCHING
                        ? vendorLine.MATCHING[0] || vendorLine.MATCHING
                        : null;

                    if (!orderLine) return;

                    var searchOption = {
                        TXN_LINK: Current.poId,
                        ITEM: vendorLine.item_num,
                        ORDER_NUM: vendorLine.order_num,
                        LINE_NO: vendorLine.line_num,
                        LINE_STATUS: vendorLine.line_status,
                        QTY: vendorLine.ship_qty
                    };

                    var orderLineResults = EXCEED_LINE_LIMIT
                        ? vclib_utils.serviceRequest({
                              moduleName: 'processV1',
                              action: 'searchOrderDetailLines',
                              parameters: searchOption
                          })
                        : vcs_processLib.searchOrderDetailLines(searchOption);

                    if (vclib_utils.isEmpty(orderLineResults)) return;

                    (orderLineResults || []).forEach(function (orderLineResult) {
                        var orderLineValue = {};
                        if (!orderLineResult.ITEM_LINK)
                            orderLineValue.ITEM_LINK = vendorLine.ITEM_LINK;

                        orderLineValue.PO_RATE = orderLine.APPLIEDRATE;
                        orderLineValue.VND_RATE = vendorLine.APPLIEDRATE;
                        orderLineValue.PO_QTY = orderLine.quantity - orderLine.quantityreceived;
                        orderLineValue.POLINE_UNIQKEY = orderLine.lineuniquekey;

                        if (EXCEED_LINE_LIMIT) {
                            vclib_utils.serviceRequest({
                                moduleName: 'processV1',
                                action: 'updateOrderDetailLine',
                                parameters: {
                                    id: orderLineResult.id,
                                    values: orderLineValue
                                }
                            });
                        } else {
                            vcs_processLib.updateOrderDetailLine({
                                id: orderLineResult.id,
                                values: orderLineValue
                            });
                        }
                    });
                });

                // ======== 3. CREATE FULFILLMENT / RECEIPT ========
                if (Current.isDropPO) {
                    fulfillmentResponse = Helper.processItemFulfillment({
                        orderData: orderStatusObj.Orders,
                        poRec: PO_REC,
                        soRec: SO_REC,
                        poId: Current.poId,
                        MainCFG: MainCFG,
                        OrderCFG: OrderCFG
                    });
                } else {
                    fulfillmentResponse = Helper.processItemReceipt({
                        orderData: orderStatusObj.Orders,
                        poRec: PO_REC,
                        soRec: SO_REC,
                        poId: Current.poId,
                        MainCFG: MainCFG,
                        OrderCFG: OrderCFG
                    });
                }

                vclib_utils.logDebug(logTitle, '## Fulfillment Response: ', fulfillmentResponse);

                // ======== 4. PROCESS SERIALS ========
                var isSerialsEnabled = false;
                var serialsEnabledMsg = '';

                if (Current.isDropPO && !MainCFG.createSerialDropship) {
                    serialsEnabledMsg = 'Serial processing for Dropship is not enabled';
                } else if (!Current.isDropPO && !MainCFG.createSerialSpecialOrder) {
                    serialsEnabledMsg = 'Serial processing for Special Order is not enabled';
                } else {
                    isSerialsEnabled = true;
                }

                if (!isSerialsEnabled) {
                    vclib_utils.logWarn(logTitle, serialsEnabledMsg);
                    vclib_utils.vcLog({
                        title: 'SS Order Status | Serials Processing',
                        recordId: Current.poId,
                        message: serialsEnabledMsg,
                        status: LOG_STATUS.WARNING
                    });
                } else {
                    orderStatusObj.Orders.forEach(function (orderData) {
                        var orderNum = orderData.VendorOrderNum;
                        var orderLines = orderStatusObj.Lines.filter(function (line) {
                            return line.order_num == orderNum;
                        });
                        var fulfillmentId =
                            fulfillmentResponse[orderNum] && fulfillmentResponse[orderNum].id;

                        var serialData = {
                            poId: Current.poId,
                            soId: Current.createdFrom
                                ? Current.createdFrom.value || Current.createdFrom
                                : null,
                            customerId: Current.customerId,
                            itemff: fulfillmentId
                        };

                        var arrSerials = EXCEED_LINE_LIMIT
                            ? vclib_utils.serviceRequest({
                                  moduleName: 'processV1',
                                  action: 'prepareSerialsFromOrderLines',
                                  parameters: util.extend(serialData, { orderLines: orderLines })
                              })
                            : vcs_processLib.prepareSerialsFromOrderLines(
                                  util.extend(serialData, { orderLines: orderLines })
                              );

                        if (!vclib_utils.isEmpty(arrSerials) && util.isArray(arrSerials)) {
                            arrSerials.forEach(function (serialOption) {
                                if (EXCEED_LINE_LIMIT)
                                    vclib_utils.serviceRequest({
                                        moduleName: 'processV1',
                                        action: 'processSerials',
                                        parameters: serialOption
                                    });
                                else vcs_processLib.processSerials(serialOption);
                            });
                        }
                    });
                }

                // ======== DONE ========
                vclib_utils.vcLog({
                    title: 'SS Order Status | Complete',
                    recordId: Current.poId,
                    message: 'Order status processed successfully',
                    status: LOG_STATUS.SUCCESS
                });

                vclib_utils.logDebug(logTitle, '###### END OF SCRIPT ######');
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                vclib_utils.vcLog({
                    title: 'SS Order Status | Error',
                    recordId: Current.poId,
                    message: errorObj.message,
                    details: errorObj.detail,
                    status: error.status || error.logStatus || LOG_STATUS.ERROR
                });

                if (Current.poId) {
                    try {
                        ns_record.submitFields({
                            type: ns_record.Type.PURCHASE_ORDER,
                            id: Current.poId,
                            values: {
                                custbody_ctc_vc_order_status: 'ERROR: ' + errorObj.errorMessage
                            }
                        });
                    } catch (saveError) {
                        vclib_utils.logWarn(
                            logTitle,
                            'Could not update PO error status',
                            saveError
                        );
                    }
                }
            } finally {
                vclib_utils.logDebug(logTitle, '###### END OF SCRIPT ######');
            }
            return true;
        }
    };

    var Helper = {
        /**
         * @function buildStatusSummary
         * @description Builds a human-readable summary string from order data
         * @param {Array} orders - Array of order objects with Status, VendorOrderNum
         * @returns {string} Summary text (max 300 chars)
         */
        buildStatusSummary: function (orders) {
            var returnValue = '';

            try {
                var statusText = [];
                var ordersByStatus = {};

                (orders || []).forEach(function (order) {
                    var status = order.Status || 'Unknown';
                    if (!ordersByStatus[status]) ordersByStatus[status] = [];
                    ordersByStatus[status].push(order.VendorOrderNum);
                });

                for (var status in ordersByStatus) {
                    statusText.push(status + ': ' + ordersByStatus[status].join(', '));
                }

                returnValue = statusText.join('; ').substring(0, 300);
            } catch (error) {
                returnValue = '';
            }

            return returnValue;
        },

        /**
         * @function mapVendorLineCols
         * @description Maps normalized lowercase vendor line fields to uppercase column names.
         * @param {Array} vendorLines - Array of vendor line objects
         * @returns {Array} Same array with uppercase fields added
         */
        mapVendorLineCols: function (vendorLines) {
            var logTitle = [LogTitle, 'mapVendorLineCols'].join('::');
            var returnValue = vendorLines;

            try {
                (vendorLines || []).forEach(function (vendorLine) {
                    for (var key in VENDOR_LINE_MAP) {
                        if (vendorLine[key] !== undefined) {
                            vendorLine[VENDOR_LINE_MAP[key]] = vendorLine[key];
                        }
                    }
                    vendorLine.ORDER_ETA_LIST = vendorLine.order_eta;
                });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        },

        /**
         * @function processItemFulfillment
         * @description Creates Item Fulfillment records from vendor order data
         * @param {Object} option - orderData, poRec, soRec, poId, MainCFG, OrderCFG
         * @returns {Object} Map of VendorOrderNum to fulfillment result
         */
        processItemFulfillment: function (option) {
            var logTitle = [LogTitle, 'processItemFulfillment'].join('::');
            var returnValue = {};

            option = option || {};

            try {
                var poId = option.poId;
                var poRec = option.poRec;
                var soRec = option.soRec;
                var orderData = option.orderData || [];
                var MainCFG = option.MainCFG;
                var OrderCFG = option.OrderCFG;

                var allowItemFF =
                    MainCFG.processDropships && OrderCFG.processDropships && MainCFG.createIF;

                if (!allowItemFF) throw ERROR_MSG.FULFILLMENT_NOT_ENABLED;
                if (!soRec) throw ERROR_MSG.STANDALONE_PO;

                var arrExistingOrders = orderData.map(function (order) {
                    return [OrderCFG.fulfillmentPrefix, order.VendorOrderNum].join('');
                });

                var arrExistingFF = vcs_txnLib.getExistingFulfillments({
                    poId: poId,
                    mainConfig: MainCFG,
                    vendorConfig: OrderCFG,
                    orderNums: arrExistingOrders,
                    recordType: ns_record.Type.ITEM_FULFILLMENT
                });

                orderData.forEach(function (order) {
                    var ffOrderNum = OrderCFG.fulfillmentPrefix + order.VendorOrderNum;
                    var orderNumUpdate = {
                        poId: poId,
                        vendorNum: order.VendorOrderNum
                    };

                    try {
                        vclib_utils.logDebug(
                            logTitle,
                            '*** PROCESSING [##' + order.VendorOrderNum + '] ***'
                        );

                        if (!vclib_utils.isEmpty(arrExistingFF[ffOrderNum])) {
                            vclib_utils.logDebug(
                                logTitle,
                                'Fulfillment already linked: ' + ffOrderNum
                            );
                            util.extend(orderNumUpdate, {
                                notes: 'Item Fulfillment Linked',
                                orderNumValues: {
                                    ITEMFF_LINK: arrExistingFF[ffOrderNum].id,
                                    NOTE: 'Item Fulfillment Linked'
                                }
                            });
                            return;
                        }

                        if (order.Lines.length == 0) {
                            throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                                detail: order.Status ? 'Order is ' + order.Status : null
                            });
                        }

                        Helper.mapVendorLineCols(order.Lines);

                        var ffOption = {
                            poRec: poRec,
                            soRec: soRec,
                            poId: poId,
                            mainConfig: MainCFG,
                            vendorConfig: OrderCFG,
                            orderNum: order.VendorOrderNum,
                            forRecordType: ns_record.Type.ITEM_FULFILLMENT,
                            headerValues: {
                                externalid: 'ifir_' + order.VendorOrderNum,
                                tranid: order.VendorOrderNum,
                                custbody_ctc_if_vendor_order_match: ffOrderNum,
                                custbody_ctc_vc_createdby_vc: true,
                                trandate: (function () {
                                    var FULFILL_DATE = vc2_constant.LIST.FULFILL_DATE;
                                    var orderShippedDate = null,
                                        orderDelivDate = null;

                                    (order.Lines || []).forEach(function (vendorLine) {
                                        if (!orderShippedDate && vendorLine.ship_date)
                                            orderShippedDate = vendorLine.ship_date;
                                        if (!orderDelivDate && vendorLine.deliv_date)
                                            orderDelivDate = vendorLine.deliv_date;
                                    });

                                    return OrderCFG.useFulfillDate == FULFILL_DATE.SHIP_DATE
                                        ? vclib_utils.parseToNSDate(orderShippedDate)
                                        : OrderCFG.useFulfillDate == FULFILL_DATE.DELIV_DATE
                                          ? vclib_utils.parseToNSDate(orderDelivDate)
                                          : new Date();
                                })()
                            },
                            vendorLines: order.Lines
                        };

                        var ffresult = EXCEED_LINE_LIMIT
                            ? vclib_utils.serviceRequest({
                                  moduleName: 'transactionLib',
                                  action: 'createFulfillment',
                                  parameters: ffOption
                              })
                            : vcs_txnLib.createFulfillment(ffOption);

                        if (ffresult.hasError)
                            throw ffresult.message || 'Unknown fulfillment error';

                        if (ffresult.success) {
                            util.extend(orderNumUpdate, {
                                notes: 'Item Fulfillment Created',
                                orderNumValues: {
                                    ITEMFF_LINK: ffresult.id,
                                    NOTE: 'Item Fulfillment Created'
                                }
                            });
                        }

                        returnValue[order.VendorOrderNum] = ffresult;
                    } catch (error) {
                        var errorObj = vclib_error.log(logTitle, error);
                        util.extend(orderNumUpdate, {
                            notes: errorObj.message,
                            orderNumValues: { NOTE: errorObj.errorMessage }
                        });
                    } finally {
                        vcs_processLib.updateOrderNum(orderNumUpdate);
                    }
                });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        },

        /**
         * @function processItemReceipt
         * @description Creates Item Receipt records from vendor order data
         * @param {Object} option - orderData, poRec, soRec, poId, MainCFG, OrderCFG
         * @returns {Object} Map of VendorOrderNum to receipt result
         */
        processItemReceipt: function (option) {
            var logTitle = [LogTitle, 'processItemReceipt'].join('::');
            var returnValue = {};

            option = option || {};

            try {
                var poId = option.poId;
                var poRec = option.poRec;
                var soRec = option.soRec;
                var orderData = option.orderData || [];
                var MainCFG = option.MainCFG;
                var OrderCFG = option.OrderCFG;

                var allowItemRcpt =
                    MainCFG.processSpecialOrders &&
                    OrderCFG.processSpecialOrders &&
                    MainCFG.createIR;

                if (!allowItemRcpt) throw ERROR_MSG.ITEMRECEIPT_NOT_ENABLED;
                if (!soRec) throw ERROR_MSG.STANDALONE_PO;

                var arrExistingOrders = orderData.map(function (order) {
                    return [OrderCFG.fulfillmentPrefix, order.VendorOrderNum].join('');
                });

                var arrExistingFF = vcs_txnLib.getExistingFulfillments({
                    poId: poId,
                    mainConfig: MainCFG,
                    vendorConfig: OrderCFG,
                    orderNums: arrExistingOrders,
                    recordType: ns_record.Type.ITEM_RECEIPT
                });

                orderData.forEach(function (order) {
                    var ffOrderNum = OrderCFG.fulfillmentPrefix + order.VendorOrderNum;
                    var orderNumUpdate = {
                        poId: poId,
                        vendorNum: order.VendorOrderNum
                    };

                    try {
                        vclib_utils.logDebug(
                            logTitle,
                            '*** PROCESSING [##' + order.VendorOrderNum + '] ***'
                        );

                        if (!vclib_utils.isEmpty(arrExistingFF[ffOrderNum])) {
                            vclib_utils.logDebug(logTitle, 'Receipt already linked: ' + ffOrderNum);
                            util.extend(orderNumUpdate, {
                                notes: 'Item Receipt Linked',
                                orderNumValues: {
                                    ITEMFF_LINK: arrExistingFF[ffOrderNum].id,
                                    NOTE: 'Item Receipt Linked'
                                }
                            });
                            return;
                        }

                        if (order.Lines.length == 0) {
                            throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                                detail: order.Status ? 'Order is ' + order.Status : null
                            });
                        }

                        Helper.mapVendorLineCols(order.Lines);

                        var irOption = {
                            poRec: poRec,
                            soRec: soRec,
                            poId: poId,
                            mainConfig: MainCFG,
                            vendorConfig: OrderCFG,
                            orderNum: order.VendorOrderNum,
                            forRecordType: ns_record.Type.ITEM_RECEIPT,
                            headerValues: {
                                externalid: 'ifir_' + order.VendorOrderNum,
                                tranid: order.VendorOrderNum,
                                custbody_ctc_if_vendor_order_match: ffOrderNum,
                                custbody_ctc_vc_createdby_vc: true,
                                trandate: new Date()
                            },
                            vendorLines: order.Lines
                        };

                        var ffresult = EXCEED_LINE_LIMIT
                            ? vclib_utils.serviceRequest({
                                  moduleName: 'transactionLib',
                                  action: 'createFulfillment',
                                  parameters: irOption
                              })
                            : vcs_txnLib.createFulfillment(irOption);

                        if (ffresult.hasError) throw ffresult.message || 'Unknown receipt error';

                        if (ffresult.success) {
                            util.extend(orderNumUpdate, {
                                notes: 'Item Receipt Created',
                                orderNumValues: {
                                    ITEMFF_LINK: ffresult.id,
                                    NOTE: 'Item Receipt Created'
                                }
                            });
                        }

                        returnValue[order.VendorOrderNum] = ffresult;
                    } catch (error) {
                        var errorObj = vclib_error.log(logTitle, error);
                        util.extend(orderNumUpdate, {
                            notes: errorObj.message,
                            orderNumValues: { NOTE: errorObj.errorMessage }
                        });
                    } finally {
                        vcs_processLib.updateOrderNum(orderNumUpdate);
                    }
                });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        }
    };

    return Endpoint;
});
