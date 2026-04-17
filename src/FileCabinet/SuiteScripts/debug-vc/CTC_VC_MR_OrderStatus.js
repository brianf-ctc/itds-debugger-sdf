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
 * Script Name: CTC VC | Process Order Status MR
 * Script ID: customscript_ctc_script_xml_v2
 *
 * @author brianf@nscatalyst.com
 * @description Polls vendors for PO status and updates related POs, IFs, and IRs.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Added PO line count check delegating >500 lines to SS; added getLineCount; throw outputObj.message on error; renamed
 *                            MISSING_SALESORDER to STANDALONE_PO
 * 2026-03-04   brianf        Improve fulfill-date selection and validation
 * 2025-01-15   brianf        Initial build.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType MapReduceScript
 */

define(function (require) {
    var ns_search = require('N/search'),
        ns_runtime = require('N/runtime'),
        ns_task = require('N/task'),
        ns_record = require('N/record');

    var vc2_util = require('./CTC_VC2_Lib_Utils.js'),
        vc2_constant = require('./CTC_VC2_Constants.js'),
        vc2_record = require('./CTC_VC2_Lib_Record.js');

    var vcs_txnLib = require('./Services/ctc_svclib_transaction.js'),
        vcs_configLib = require('./Services/ctc_svclib_configlib.js'),
        vcs_processLib = require('./Services/ctc_svclib_process-v1.js'),
        vcs_websvcLib = require('./Services/ctc_svclib_webservice.js');

    var vclib_error = require('./Services/lib/ctc_lib_error.js');

    var LogTitle = 'MR_OrderStatus',
        VCLOG_APPNAME = vc2_constant.APPNAME.ORDER_STATUS;

    var LogPrefix = '';
    var ScriptParam = {},
        MAX_NO_PO = 20,
        MAX_NO_DEPLOYMENTS = 50;

    var ERROR_MSG = vc2_constant.ERRORMSG,
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

    var PO_COLS = {
        poNum: 'tranid',
        tranDate: 'trandate',
        vendorId: 'entity',
        createdFrom: 'createdfrom',
        poLinkType: 'custbody_ctc_po_link_type',
        isDropShip: 'custbody_isdropshippo',
        isBypassVC: 'custbody_ctc_bypass_vc',
        subsidiary: vc2_constant.GLOBAL.ENABLE_SUBSIDIARIES ? 'subsidiary' : null,
        overridePO: vc2_constant.FIELD.TRANSACTION.OVERRIDE_PONUM
    };

    /////////////////////////////////////////////////////////
    var MAP_REDUCE = {};

    /**
     *   Get the list of PO to process from a saved search
     */
    MAP_REDUCE.getInputData = function () {
        var logTitle = [LogTitle, 'getInputData'].join('::');
        vc2_util.logDebug(logTitle, '###### START OF SCRIPT ######');

        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        var returnValue;

        try {
            /// fetch the script parameters
            ScriptParam = Helper.getParameters();

            var license = vcs_configLib.validateLicense();
            if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

            var MainCFG = vcs_configLib.mainConfig();
            if (!MainCFG) throw ERROR_MSG.MISSING_CONFIG;

            if (!MainCFG.processDropships && !MainCFG.processSpecialOrders)
                throw ERROR_MSG.NO_PROCESS_DROPSHIP_SPECIALORD;

            if (!ScriptParam.searchId) throw ERROR_MSG.MISSING_ORDERSTATUS_SEARCHID;

            // load the initial search for open POs
            var searchRec = ns_search.load({ id: ScriptParam.searchId }),
                searchCols = (function () {
                    var arrCols = [];
                    for (var col in PO_COLS) if (PO_COLS[col]) arrCols.push(PO_COLS[col]);

                    arrCols.push(
                        ns_search.createColumn({
                            name: 'internalid',
                            join: 'vendor'
                        }),
                        ns_search.createColumn({
                            name: 'datecreated',
                            sort: ns_search.Sort.DESC
                        })
                    );

                    return arrCols;
                })(),
                searchNew;

            // collect the PO Internal Ids, if specified
            var arrInternalId = !vc2_util.isEmpty(ScriptParam.internalid)
                ? ScriptParam.internalid.split(/\s*,\s*/g)
                : [];

            //////////////////////////////////////////////////////////////////////////////////////
            /// if no internal id is specified, then fetch the POs to process
            if (vc2_util.isEmpty(ScriptParam.internalid)) {
                var searchOption = {
                    type: searchRec.searchType,
                    filters: searchRec.filters,
                    columns: searchCols
                };

                // add the active vendor filter, and if vendor id is specified, then add it to the filter
                searchOption.filters.push(
                    (function () {
                        var vendorFilterFormula = [],
                            activeVendors = Helper.fetchActiveVendors();

                        activeVendors.forEach(function (activVendor) {
                            if (
                                ScriptParam.vendorId &&
                                !vc2_util.inArray(ScriptParam.vendorId, activVendor.vendor)
                            )
                                return;

                            var vendorIds = activVendor.vendor
                                .map(function (id) {
                                    return '{vendor.internalid}=' + id;
                                })
                                .join(' OR ');

                            /// add it to the vendor filter formula
                            vendorFilterFormula.push(
                                '(' +
                                    ('(' + vendorIds + ')') +
                                    // ('{vendor.internalid}=' + activeVendors[i].vendor) +
                                    (" AND {trandate}>='" + activVendor.startDate + "')")
                            );

                            // vc2_util.log(logTitle, '... added vendor id: ', [activVendor]);
                        });
                        vc2_util.log(logTitle, '... vendorFilterFormula: ', vendorFilterFormula);

                        return ns_search.createFilter({
                            name: 'formulanumeric',
                            operator: ns_search.Operator.EQUALTO,
                            values: [1],
                            formula:
                                'CASE WHEN ' +
                                (vendorFilterFormula.join(' OR ') + ' THEN 1 ELSE 0 END')
                        });
                    })()
                );

                var listPOids = [];

                // run the search and collect all the PO Ids
                ns_search
                    .create(searchOption)
                    .run()
                    .each(function (row) {
                        listPOids.push(row.id);
                        return true;
                    });
                listPOids = vc2_util.uniqueArray(listPOids);
                arrInternalId = listPOids;

                vc2_util.log(logTitle, '... POs to process: ', listPOids.length);
                if (listPOids.length > MAX_NO_PO) {
                    var arrChunkedPOIds = vc2_util.sliceArrayIntoChunks(listPOids, MAX_NO_PO);

                    vc2_util.log(logTitle, '... chunked POs: ', {
                        total: arrChunkedPOIds.length,
                        max: MAX_NO_PO,
                        list: arrChunkedPOIds
                    });

                    // sent the first chunk to arrInternalId
                    arrInternalId = arrChunkedPOIds.shift();

                    // then create deployments for the rest
                    arrChunkedPOIds.forEach(function (chunkPOIds) {
                        var taskOption = {
                            scriptId: ns_runtime.getCurrentScript().id,
                            isMapReduce: true,
                            scriptParams: {
                                custscript_orderstatus_searchid: ScriptParam.searchId,
                                custscript_orderstatus_orderid: chunkPOIds.join(',')
                            }
                        };
                        vc2_util.log(logTitle, '... taskOption: ', taskOption);

                        Helper.forceDeploy(taskOption);
                    });
                }
            }

            // now run the search for the internal ids
            if (arrInternalId.length) {
                var searchOption = {
                    type: searchRec.searchType,
                    filters: [
                        ['mainline', 'is', 'T'],
                        'AND',
                        ['internalid', 'anyof', arrInternalId]
                    ],
                    columns: searchCols
                };
                vc2_util.log(logTitle, '... search option: ', searchOption);
                searchNew = ns_search.create(searchOption);
            }

            returnValue = searchNew;
        } catch (error) {
            throw vclib_error.log(logTitle, error).message;
        }
        if (!returnValue) return false;

        var totalResults = returnValue.runPaged().count;

        vc2_util.log(
            logTitle,
            { type: 'debug', msg: '>> Total Orders to Process: ' },
            totalResults
        );

        vc2_util.vcLog({
            title: 'VAR Connect START',
            body:
                'VAR Connect START' +
                ('\n\nTotal Orders: ' + totalResults) +
                ('\nParameters: ' + JSON.stringify(ScriptParam))
        });

        return returnValue;
    };

    MAP_REDUCE.map = function (mapContext) {
        var logTitle = [LogTitle, 'map', mapContext.key].join('::');
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        var Current = {}; // Local declaration

        try {
            var outputObj;
            var searchResult = JSON.parse(mapContext.value);
            LogPrefix = '[purchaseorder:' + searchResult.id + '] MAP | ';
            vc2_util.LogPrefix = LogPrefix;

            var poUpdateValue = {};
            vc2_util.logDebug(logTitle, '###### START: MAP ######');

            Helper.getParameters();
            Current.poId = searchResult.id;
            for (var colName in PO_COLS) {
                var colField = PO_COLS[colName];
                Current[colName] = searchResult.values[colField];
            }
            vc2_util.log(logTitle, '..current: ', Current);

            if (vc2_util.isTrue(Current.isBypassVC)) throw ERROR_MSG.BYPASS_VARCONNECT;

            // Check PO line count — delegate to Scheduled Script if it exceeds 500
            Current.lineCount = Helper.getLineCount({ poId: Current.poId });
            vc2_util.log(logTitle, '... PO line count: ', Current.lineCount);

            if (Current.lineCount > 500) {
                vc2_util.log(logTitle, '** PO line count exceeds 500, delegating to SS **', {
                    lineCount: Current.lineCount,
                    poId: Current.poId
                });

                var taskOption = {
                    scriptId: vc2_constant.SCRIPT.ORDERSTATUS_SS,
                    scriptParams: {}
                };
                taskOption.scriptParams['custscript_ctcvc_orderstat_poid'] = Current.poId;
                taskOption.deployId = Helper.forceDeploy(taskOption);

                vc2_util.vcLog({
                    title: 'MR Order Status | Delegated to SS',
                    recordId: Current.poId,
                    message: 'PO has ' + Current.lineCount + ' lines; delegated to Scheduled Script'
                });

                return;
            }

            Current.MainCFG = vcs_configLib.mainConfig();
            Current.OrderCFG = vcs_configLib.orderVendorConfig({ poId: Current.poId });
            if (!Current.OrderCFG) throw ERROR_MSG.MISSING_VENDORCFG;

            /// OVERRIDE ///
            if (Current.MainCFG.overridePONum) {
                var tempPONum = Current.overridePO;
                if (tempPONum) {
                    Current.poNum = tempPONum;
                    vc2_util.log(logTitle, '**** TEMP PO NUM: ' + tempPONum + ' ****');
                }
            }

            /// ORDER STATUS ///
            outputObj = vcs_websvcLib.OrderStatus({ poNum: Current.poNum, poId: Current.poId });
            vc2_util.vcLog({
                title: 'MR Order Status | Output ',
                recordId: Current.poId,
                message: vc2_util.extractError(outputObj.Lines)
            });

            // check for errors
            if (outputObj.hasError) throw outputObj.message;
            else if (vc2_util.isEmpty(outputObj.Orders) || vc2_util.isEmpty(outputObj.Lines))
                throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                    details: outputObj.message || 'No lines to process'
                });
            else {
                poUpdateValue['custbody_ctc_vc_order_status'] = (function () {
                    var statusText = [];

                    // group by status
                    var ordersByStatus = {};
                    (outputObj.Orders || []).forEach(function (order) {
                        var status = (order.Status || 'NA').toUpperCase();

                        if (!ordersByStatus[status]) ordersByStatus[status] = [];
                        ordersByStatus[status].push(order.VendorOrderNum);
                    });

                    // create the status text by status and print the order.vendorordernum
                    for (var status in ordersByStatus) {
                        statusText.push('[' + status + '] ' + ordersByStatus[status].join(','));
                    }

                    // return the status text, but not more than 300 characters
                    return statusText.join('; ').substring(0, 300);
                })();
            }

            // send them in one go
            vc2_util.log(logTitle, '/// Order Data: ', outputObj.Orders);
            mapContext.write(Current.poId, util.extend(Current, { OrderData: outputObj }));

            /// reset the order lines
            vcs_processLib.cleanupOrderStatusLines({ poId: Current.poId });

            (outputObj.Orders || []).forEach(function (OrderData) {
                vc2_util.log(logTitle, '/// Order Data: ', OrderData);

                /**
                 * Usage used by the processOrderStatusLines
                 * 1. do search txnRecord (5)
                 * 2. search for order record (5)
                 * 3. create/update order record (2)
                 * 4. create/update order line record (2xlines)
                 */
                var remUsage = ns_runtime.getCurrentScript().getRemainingUsage();
                var estimateUsage = 12 + 4 * OrderData.Lines.length + 500; // 500 is the buffer
                vc2_util.log(logTitle, 'Estimate Usage: ', [estimateUsage, remUsage]);

                if (remUsage > estimateUsage) {
                    vc2_util.log(logTitle, 'Usage Remaining: ', {
                        rem: remUsage,
                        est: estimateUsage,
                        lines: OrderData.Lines.length
                    });

                    // there's enough for this order
                    vcs_processLib.processOrderStatusLines(
                        util.extend(OrderData, {
                            ConfigRec: Current.OrderCFG,
                            poId: Current.poId,
                            poNum: Current.poNum
                        })
                    );
                } else {
                    vc2_util.serviceRequest({
                        moduleName: 'processV1',
                        action: 'processOrderStatusLines',
                        parameters: util.extend(OrderData, {
                            ConfigRec: Current.OrderCFG,
                            poId: Current.poId,
                            poNum: Current.poNum
                        })
                    });
                }
            });
        } catch (error) {
            var errorObj = vclib_error.log(logTitle, error);
            vc2_util.vcLog({
                title: 'MR Order Status | Unsuccessful',
                recordId: Current.poId,
                message: errorObj.message,
                details: errorObj.detail,
                status: error.status || error.logStatus || LOG_STATUS.ERROR
            });

            poUpdateValue['custbody_ctc_vc_order_status'] = 'ERROR: ' + errorObj.errorMessage;
        } finally {
            ns_record.submitFields({
                type: 'purchaseorder',
                id: searchResult.id,
                values: poUpdateValue
            });

            vc2_util.logDebug(logTitle, '###### END: MAP ###### ');
        }
    };

    MAP_REDUCE.reduce = function (context) {
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        var logTitle = [LogTitle, 'reduce'].join('::');
        LogPrefix = 'REDUCE [purchaseorder:' + context.key + ' ] ';
        vc2_util.LogPrefix = LogPrefix;

        var Current = {}; // Local declaration

        try {
            vc2_util.logDebug(logTitle, '###### START: REDUCE ###### ');
            ScriptParam = Helper.getParameters();

            Current.poId = context.key;
            util.extend(Current, JSON.parse(context.values[0]));

            vc2_util.dumpLog(logTitle, Current.OrderData, '// Order Data');

            Current.MainCFG = vcs_configLib.mainConfig();
            Current.OrderCFG = vcs_configLib.orderVendorConfig({ poId: Current.poId });
            if (!Current.OrderCFG) throw ERROR_MSG.MISSING_VENDORCFG;

            var PO_REC = vc2_record.load({
                type: 'purchaseorder',
                id: Current.poId,
                isDynamic: true
            });

            Current.isDropPO =
                PO_REC.getValue({ fieldId: 'dropshipso' }) ||
                PO_REC.getValue({
                    fieldId: 'custbody_ctc_po_link_type'
                }) == 'Drop Shipment' ||
                PO_REC.getValue({ fieldId: 'custbody_isdropshippo' });

            //// UPDATE the PURCHASE ORDER
            var updateResult = vcs_txnLib.updatePurchaseOrder({
                poId: Current.poId,
                poRec: PO_REC,
                mainConfig: Current.MainCFG,
                orderConfig: Current.OrderCFG,
                isDropShip: Current.isDropPO,
                vendorLines: (function () {
                    var arrVendorLines = [];

                    // we need to send the vendorLines with the following fields:
                    // item_names: ITEM_TEXT, ITEM_ALT, ITEM_MPN, ITEM_SKU
                    Current.OrderData.Lines.forEach(function (vendorLine) {
                        // arrVendorLines.push({
                        util.extend(vendorLine, {
                            ORDER_NUM: vendorLine.order_num,
                            ORDER_STATUS: vendorLine.order_status,

                            ORDER_DATE: vendorLine.order_date,
                            SHIP_DATE: vendorLine.ship_date,

                            ORDER_ETA: vendorLine.order_eta,
                            ORDER_ETA_LIST: vendorLine.order_eta,
                            DELIV_ETA: vendorLine.deliv_eta,
                            DELIV_DATE: vendorLine.deliv_date,

                            ITEM_TEXT: vendorLine.item_num,
                            ITEM_ALT: vendorLine.item_num_alt,

                            CARRIER: vendorLine.carrier,
                            TRACKING_NUMS: vendorLine.tracking_num,
                            SERIAL_NUMS: vendorLine.serial_num,
                            // APPLIEDRATE: vendorLine.appliedrate,
                            QUANTITY: vendorLine.ship_qty
                        });
                    });
                    return Current.OrderData.Lines;

                    // return arrVendorLines;
                })(),
                doSave: true
            });
            vc2_util.log(logTitle, '... PO Update Result: ', updateResult);
            ////

            /// UPDATE the ORDERNUM Lines ///
            vc2_util.log(logTitle, '... total OrderData lines... ', Current.OrderData.Lines.length);

            Current.OrderData.Lines.forEach(function (vendorLine) {
                // update the order status lines
                var orderLine = vendorLine.MATCHING
                    ? vendorLine.MATCHING[0] || vendorLine.MATCHING
                    : null;

                if (!orderLine) {
                    vc2_util.log(logTitle, '... no matching order line found', [
                        vendorLine,
                        orderLine
                    ]);
                    return;
                }

                vc2_util.log(logTitle, '... processing vendor line', vendorLine);

                // search for the vendorLine record
                var orderLineResults = vcs_processLib.searchOrderDetailLines({
                    TXN_LINK: Current.poId,
                    ITEM: vendorLine.item_num,
                    ORDER_NUM: vendorLine.order_num,
                    LINE_NO: vendorLine.line_num,
                    LINE_STATUS: vendorLine.line_status,
                    QTY: vendorLine.ship_qty
                });

                if (vc2_util.isEmpty(orderLineResults)) {
                    vc2_util.log(logTitle, '... no order lines found for vendor line', [
                        vendorLine,
                        orderLine
                    ]);
                    return;
                }

                vc2_util.log(logTitle, '... order line results found', orderLineResults);

                (orderLineResults || []).forEach(function (orderLineResult) {
                    var orderLineValue = {};
                    if (!orderLineResult.ITEM_LINK) orderLineValue.ITEM_LINK = vendorLine.ITEM_LINK;

                    orderLineValue.PO_RATE = orderLine.APPLIEDRATE;
                    orderLineValue.VND_RATE = vendorLine.APPLIEDRATE;
                    orderLineValue.PO_QTY = orderLine.quantity - orderLine.quantityreceived;
                    orderLineValue.POLINE_UNIQKEY = orderLine.lineuniquekey;

                    vcs_processLib.updateOrderDetailLine({
                        id: orderLineResult.id,
                        values: orderLineValue
                    });
                });
            });

            // Add the PO LInes //
            var SO_REC = null,
                SO_DATA;

            try {
                SO_REC = ns_record.load({
                    type: ns_record.Type.SALES_ORDER,
                    id: Current.createdFrom.value
                });

                SO_DATA = vc2_record.extractValues({
                    record: SO_REC,
                    fields: ['entity']
                });
                Current.customerId = SO_REC.getValue('entity');
            } catch (so_error) {
                vc2_util.log(logTitle, '// Error loading the Sales Order');
            }
            vc2_util.log(logTitle, '... SO_DATA: ', SO_DATA);

            var fulfillmentResponse = {};
            if (Current.isDropPO) {
                fulfillmentResponse = Helper.processItemFulfillment({
                    orderData: Current.OrderData.Orders,
                    poRec: PO_REC,
                    soRec: SO_REC,
                    poId: Current.poId,
                    MainCFG: Current.MainCFG,
                    OrderCFG: Current.OrderCFG
                });
            } else {
                fulfillmentResponse = Helper.processItemReceipt({
                    orderData: Current.OrderData.Orders,
                    poRec: PO_REC,
                    soRec: SO_REC,
                    poId: Current.poId,
                    mainConfig: Current.MainCFG,
                    orderConfig: Current.OrderCFG
                });
            }
            vc2_util.log(logTitle, '## fulfillmentResponse: ', fulfillmentResponse);

            // Check if serial number processing is enabled
            var isSerialsEnabled = false,
                serialsEnabledMsg = '';

            if (Current.isDropPO && !Current.MainCFG.createSerialDropship) {
                serialsEnabledMsg = 'Serial processing for Dropship is not enabled';
                isSerialsEnabled = false;
            } else if (!Current.isDropPO && !Current.MainCFG.createSerialSpecialOrder) {
                serialsEnabledMsg = 'Serial processing for Special Order is not enabled';
                isSerialsEnabled = false;
            } else {
                isSerialsEnabled = true;
            }

            if (!isSerialsEnabled) {
                vc2_util.logWarn(logTitle, serialsEnabledMsg);
                vc2_util.vcLog({
                    title: 'MR Order Status | Serials Processing',
                    recordId: Current.poId,
                    message: serialsEnabledMsg,
                    status: LOG_STATUS.WARNING
                });
            } else {
                Current.OrderData.Orders.forEach(function (orderData) {
                    var orderNum = orderData.VendorOrderNum;

                    var orderLines = Current.OrderData.Lines.filter(function (line) {
                            return line.order_num == orderNum;
                        }),
                        fulfillmentId =
                            fulfillmentResponse[orderNum] && fulfillmentResponse[orderNum].id;

                    /// prepare serial data
                    var serialData = {
                        poId: Current.poId,
                        soId: Current.createdFrom.value,
                        customerId: Current.customerId,
                        itemff: fulfillmentId
                    };

                    arrSerials = vcs_processLib.prepareSerialsFromOrderLines(
                        vc2_util.extend(serialData, { orderLines: orderLines })
                    );

                    if (!vc2_util.isEmpty(arrSerials) && util.isArray(arrSerials)) {
                        arrSerials.forEach(function (serialOption) {
                            Helper.processSerials(serialOption);
                        });
                    }
                });
            }
        } catch (error) {
            var errorObj = vclib_error.log(logTitle, error);
            vc2_util.vcLog({
                title: 'MR Order Status | Unsuccessful',
                recordId: Current.poId,
                message: errorObj.message,
                details: errorObj.detail,
                status: error.status || error.logStatus || LOG_STATUS.ERROR
            });
        } finally {
            vc2_util.logDebug(logTitle, '###### END: REDUCE ###### ');
        }
    };

    MAP_REDUCE.summarize = function (summary) {
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        //any errors that happen in the above methods are thrown here so they should be handled
        //log stuff that we care about, like number of serial numbers
        var logTitle = [LogTitle, 'summarize'].join('::');

        vc2_util.logDebug(logTitle, '###### START: SUMMARY ###### ');

        summary.reduceSummary.errors.iterator().each(function (key, error) {
            vc2_util.logError(logTitle, [key, error]);
            return true;
        });
        var reduceKeys = [];
        summary.reduceSummary.keys.iterator().each(function (key) {
            reduceKeys.push(key);
            return true;
        });
        vc2_util.log(logTitle, 'REDUCE keys processed', reduceKeys);

        vc2_util.log(logTitle, '**** SUMMARY ****', {
            'Total Usage': summary.usage,
            'No of Queues': summary.concurrency,
            'Total Time (sec)': summary.seconds,
            Yields: summary.yields
        });

        vc2_util.vcLog({
            title: 'VAR Connect END',
            message:
                'VAR Connect END' +
                ('\n\nTotal Usage: ' + summary.usage) +
                ('\nTotal Time (sec): ' + summary.seconds)
        });

        // do a cleanup
        Helper.cleanUpDeployment({ scriptId: ns_runtime.getCurrentScript().id, isMapReduce: true });

        vc2_util.logDebug(logTitle, '###### END OF SCRIPT ###### ');
    };

    var Helper = {
        getParameters: function () {
            var logTitle = [LogTitle, 'getParameters'].join('::');
            var currentScript = ns_runtime.getCurrentScript();

            ScriptParam = {
                searchId: currentScript.getParameter('custscript_orderstatus_searchid'),
                vendorId: currentScript.getParameter('custscript_orderstatus_vendorid'),
                internalid: currentScript.getParameter('custscript_orderstatus_orderid'),
                use_fulfill_rl: currentScript.getParameter('custscript_orderstatus_restletif')
            };
            vc2_util.log(logTitle, { type: 'debug', msg: '/// Params ' }, ScriptParam);

            return ScriptParam;
        },
        fetchActiveVendors: function () {
            var logTitle = [LogTitle, 'fetchActiveVendors'].join('::');

            var objVendorSearch = ns_search.create({
                type: 'customrecord_ctc_vc_vendor_config',
                filters: [['isinactive', 'is', 'F']],
                columns: [
                    'custrecord_ctc_vc_vendor',
                    'custrecord_ctc_vc_vendor_start',
                    'custrecord_ctc_vc_xml_vendor'
                ]
            });

            var arrVendors = [];
            objVendorSearch.run().each(function (result) {
                var vendorList = result.getValue({
                        name: 'custrecord_ctc_vc_vendor'
                    }),
                    startDate = result.getValue({
                        name: 'custrecord_ctc_vc_vendor_start'
                    });

                if (vendorList) {
                    arrVendors.push({
                        vendor: vendorList.split(/,/gi),
                        startDate: startDate
                    });
                }

                return true;
            });

            return arrVendors;
        },
        processItemFulfillment: function (option) {
            var logTitle = [LogTitle, 'processItemFulfillment'].join('::'),
                returnValue = {};

            var Current = {};

            try {
                Current.poId = option.poId;
                Current.poRec = option.poRec;
                Current.soRec = option.soRec;
                Current.orderData = option.orderData || option.OrderData;

                var MainCFG = option.MainCFG || vcs_configLib.mainConfig(),
                    OrderCFG =
                        option.OrderCFG || vcs_configLib.orderVendorConfig({ poId: Current.poId });

                var allowItemFF =
                    MainCFG.processDropships && OrderCFG.processDropships && MainCFG.createIF;

                if (!allowItemFF) throw ERROR_MSG.FULFILLMENT_NOT_ENABLED;

                // look for the SALES ORDER
                if (!Current.soRec) throw ERROR_MSG.STANDALONE_PO;

                // get all the existing fulfillments
                var arrExistingOrders = Current.orderData.map(function (orderData) {
                    return [OrderCFG.fulfillmentPrefix, orderData.VendorOrderNum].join('');
                });

                var arrExistingFF = vcs_txnLib.getExistingFulfillments({
                    poId: Current.poId,
                    mainConfig: MainCFG,
                    vendorConfig: OrderCFG,
                    orderNums: arrExistingOrders,
                    recordType: ns_record.Type.ITEM_FULFILLMENT
                });

                // for each option.OrderData
                Current.orderData.forEach(function (orderData) {
                    var logPrefix = '[#' + orderData.VendorOrderNum + '] ';

                    var ffresult = {},
                        ffOrderNum = OrderCFG.fulfillmentPrefix + orderData.VendorOrderNum,
                        orderNumUpdate = {
                            poId: Current.poId,
                            vendorNum: orderData.VendorOrderNum
                        };

                    try {
                        vc2_util.log(
                            logTitle,
                            '*** PROCESSING [##' + orderData.VendorOrderNum + '] ***'
                        );

                        if (!vc2_util.isEmpty(arrExistingFF[ffOrderNum])) {
                            vc2_util.log(logTitle, 'Fulfillment linked: ' + ffOrderNum);

                            util.extend(orderNumUpdate, {
                                notes: 'Item Fulfillment Linked',
                                orderNumValues: {
                                    ITEMFF_LINK: arrExistingFF[ffOrderNum].id,
                                    NOTE: 'Item Fulfillment Linked',
                                    DETAILS: ' '
                                }
                            });

                            ffresult = {
                                id: arrExistingFF[ffOrderNum].id,
                                success: false
                            };

                            return;
                        }

                        if (orderData.Lines.length == 0) {
                            throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                                detail: orderData.Status ? 'Order is ' + orderData.Status : null
                            });
                        }

                        // Create fulfillment option object with all necessary configuration
                        var ffOption = {
                            // NetSuite record objects
                            poRec: Current.poRec,
                            soRec: Current.soRec,
                            poId: Current.poId,

                            // Configuration objects
                            mainConfig: MainCFG,
                            vendorConfig: OrderCFG,

                            // Order identification
                            orderNum: orderData.VendorOrderNum,
                            forRecordType: ns_record.Type.ITEM_FULFILLMENT,

                            // Header field values for the fulfillment record
                            headerValues: {
                                externalid: 'ifir_' + orderData.VendorOrderNum,
                                tranid: orderData.VendorOrderNum,
                                custbody_ctc_if_vendor_order_match: ffOrderNum,
                                custbody_ctc_vc_createdby_vc: true,

                                // Determine transaction date based on config settings
                                trandate: (function () {
                                    var FULFILL_DATE = vc2_constant.LIST.FULFILL_DATE;
                                    var orderShippedDate = null,
                                        orderDelivDate = null;

                                    // Extract ship and delivery dates from order lines
                                    orderData.Lines.forEach(function (vendorLine) {
                                        orderShippedDate = vendorLine.ship_date;
                                        orderDelivDate = vendorLine.deliv_date;
                                    });

                                    return OrderCFG.useFulfillDate == FULFILL_DATE.SHIP_DATE
                                        ? vc2_util.parseToNSDate(orderShippedDate)
                                        : OrderCFG.useFulfillDate == FULFILL_DATE.DELIV_DATE
                                          ? vc2_util.parseToNSDate(orderDelivDate)
                                          : new Date();
                                })()
                            },

                            // Transform order lines into vendor lines format for fulfillment processing
                            vendorLines: (function () {
                                var vendorLines = [];
                                (orderData.Lines || []).forEach(function (vendorLine) {
                                    // if (vendorLine.SKIPPED) return;

                                    // Map vendor line data to standardized fulfillment line format
                                    vendorLines.push({
                                        // Order information
                                        ORDER_NUM: vendorLine.order_num,
                                        ORDER_STATUS: vendorLine.order_status,

                                        // Date fields
                                        ORDER_DATE: vendorLine.order_date,
                                        SHIP_DATE: vendorLine.ship_date,
                                        ORDER_ETA: vendorLine.order_eta,
                                        ORDER_ETA_LIST: vendorLine.order_eta,
                                        DELIV_ETA: vendorLine.deliv_eta,
                                        DELIV_DATE: vendorLine.deliv_date,

                                        // Item identification
                                        ITEM_TEXT: vendorLine.item_num,
                                        ITEM_ALT: vendorLine.item_num_alt,

                                        // Shipping information
                                        CARRIER: vendorLine.carrier,
                                        TRACKING_NUMS: vendorLine.tracking_num,
                                        SERIAL_NUMS: vendorLine.serial_num,

                                        // Quantity and shipping status
                                        QUANTITY: vendorLine.ship_qty,
                                        IS_SHIPPED: vendorLine.is_shipped,
                                        NOTSHIPPED: vendorLine.NOTSHIPPED
                                    });
                                });

                                return vendorLines;
                            })()
                        };

                        ffresult = vcs_txnLib.createFulfillment(ffOption);
                        if (ffresult.hasError)
                            throw (
                                (ffresult && (ffresult.errorObj || ffresult.message)) ||
                                'Unknown fulfillment error'
                            );

                        vc2_util.log(logTitle, '... fulfillment result: ', ffresult);

                        if (ffresult.success) {
                            util.extend(orderNumUpdate, {
                                notes: 'Item Fulfillment Created',
                                orderNumValues: {
                                    ITEMFF_LINK: ffresult.id,
                                    NOTE: 'Item Fulfillment Created',
                                    DETAILS: ' '
                                }
                            });

                            vc2_util.vcLog({
                                title: 'Fulfillment | Successfully Created',
                                recordId: Current.poId,
                                successMsg: vc2_util.printSuccessLog({
                                    recordType: 'Item Fulfillment',
                                    recordId: ffresult.id,
                                    lines: (function () {
                                        var arrLines = [];

                                        (ffresult.Lines || []).forEach(function (line) {
                                            arrLines.push({
                                                Item: line.item_text,
                                                Qty: line.quantity,
                                                OrderNum: line.VENDORLINE.ORDER_NUM,
                                                Date: line.VENDORLINE.ORDER_DATE,
                                                ETA: line.VENDORLINE.ORDER_ETA || 'NA',
                                                Delivery: line.VENDORLINE.DELIV_DATE || 'NA',
                                                Shipped: line.VENDORLINE.SHIP_DATE || 'NA',
                                                Carrier: line.VENDORLINE.CARRIER || 'NA',
                                                Tracking: line.VENDORLINE.TRACKING_NUMS || 'NA',
                                                Serials: line.VENDORLINE.SERIAL_NUMS || 'NA'
                                            });
                                        });

                                        return arrLines;
                                    })()
                                })
                            });
                        }
                    } catch (fulfillmentError) {
                        var errorObj = vclib_error.log(logTitle, fulfillmentError);

                        vc2_util.vcLog({
                            title: 'Fulfillment Error | ' + orderData.VendorOrderNum,
                            warning: logPrefix + errorObj.errorMessage,
                            recordId: Current.poId
                        });

                        util.extend(orderNumUpdate, {
                            notes: errorObj,
                            orderNumValues: {
                                NOTE: errorObj.errorMessage,
                                DETAILS: ' '
                            }
                        });
                    } finally {
                        vc2_util.log(logTitle, '## Fulfillment Result: ', [
                            ffresult,
                            orderNumUpdate
                        ]);

                        // update the orderNum record
                        vcs_processLib.updateOrderNum(orderNumUpdate);

                        returnValue[orderData.VendorOrderNum] = ffresult;
                    }

                    return true;
                });
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                vc2_util.vcLog({
                    title: 'Fulfillment Creation | Error',
                    error: errorObj.errorMessage,
                    recordId: Current.poId
                });

                Helper.updateOrderNumNotes({
                    poRec: Current.poRec,
                    poId: Current.poId,
                    orderNums: (function () {
                        var arrOrderNums = [];
                        option.orderData.forEach(function (orderData) {
                            arrOrderNums.push(orderData.VendorOrderNum);
                        });

                        return arrOrderNums;
                    })(),
                    notes: errorObj.errorMessage
                });

                returnValue = errorObj;
            }

            return returnValue;
        },
        processItemReceipt: function (option) {
            var logTitle = [LogTitle, 'processItemReceipt'].join('::'),
                returnValue = {};

            var Current = {};

            try {
                Current.poId = option.poId;
                Current.poRec = option.poRec;
                Current.soRec = option.soRec;
                Current.orderData = option.orderData || option.OrderData;

                var MainCFG = option.MainCFG || vcs_configLib.mainConfig(),
                    OrderCFG =
                        option.OrderCFG || vcs_configLib.orderVendorConfig({ poId: Current.poId });

                var allowItemRcpt =
                    MainCFG.processSpecialOrders &&
                    OrderCFG.processSpecialOrders &&
                    MainCFG.createIR;

                if (!allowItemRcpt) throw ERROR_MSG.ITEMRECEIPT_NOT_ENABLED;
                // look for the SALES ORDER
                if (!Current.soRec) throw ERROR_MSG.STANDALONE_PO;

                // get all the existing fulfillments
                var arrExistingOrders = Current.orderData.map(function (orderData) {
                    return [OrderCFG.fulfillmentPrefix, orderData.VendorOrderNum].join('');
                });

                var arrExistingFF = vcs_txnLib.getExistingFulfillments({
                    poId: Current.poId,
                    mainConfig: MainCFG,
                    vendorConfig: OrderCFG,
                    orderNums: arrExistingOrders,
                    recordType: ns_record.Type.ITEM_RECEIPT
                });

                // for each option.OrderData
                Current.orderData.forEach(function (orderData) {
                    var logPrefix = '[#' + orderData.VendorOrderNum + '] ';

                    var ffresult = {},
                        ffOrderNum = OrderCFG.fulfillmentPrefix + orderData.VendorOrderNum,
                        orderNumUpdate = {
                            poId: Current.poId,
                            vendorNum: orderData.VendorOrderNum
                        };

                    try {
                        vc2_util.log(
                            logTitle,
                            '*** PROCESSING [##' + orderData.VendorOrderNum + '] ***'
                        );

                        if (!vc2_util.isEmpty(arrExistingFF[ffOrderNum])) {
                            vc2_util.log(logTitle, 'Item Receipt linked: ' + ffOrderNum);

                            util.extend(orderNumUpdate, {
                                notes: 'Item Receipt Linked',
                                orderNumValues: {
                                    ITEMFF_LINK: arrExistingFF[ffOrderNum].id,
                                    NOTE: 'Item Receipt Linked',
                                    DETAILS: ' '
                                }
                            });

                            return;
                        }

                        if (orderData.Lines.length == 0) {
                            throw util.extend(ERROR_MSG.NO_LINES_TO_PROCESS, {
                                detail: orderData.Status ? 'Order is ' + orderData.Status : null
                            });
                        }

                        // Create receipt option object with all necessary configuration
                        var ffOption = {
                            poRec: Current.poRec,
                            soRec: Current.soRec,
                            poId: Current.poId,
                            mainConfig: MainCFG,
                            vendorConfig: OrderCFG,
                            orderNum: orderData.VendorOrderNum,
                            forRecordType: ns_record.Type.ITEM_RECEIPT,
                            // Header field values for the item receipt record
                            headerValues: {
                                externalid: 'ifir_' + orderData.VendorOrderNum,
                                tranid: orderData.VendorOrderNum,
                                custbody_ctc_if_vendor_order_match: ffOrderNum,
                                custbody_ctc_vc_createdby_vc: true,
                                // Determine transaction date based on config settings
                                trandate: (function () {
                                    var orderShippedDate = null;
                                    // Extract ship date from order lines
                                    orderData.Lines.forEach(function (vendorLine) {
                                        orderShippedDate = vendorLine.ship_date;
                                    });
                                    // Priority: ship date when enabled and valid; otherwise null
                                    return (OrderCFG.useShipDate == true ||
                                        OrderCFG.useShipDate == 'T') &&
                                        !vc2_util.isEmpty(orderShippedDate) &&
                                        orderShippedDate !== 'NA'
                                        ? vc2_util.parseToNSDate(orderShippedDate)
                                        : null;
                                })()
                            },
                            // Transform order lines into vendor lines format for receipt processing
                            vendorLines: (function () {
                                var vendorLines = [];
                                (orderData.Lines || []).forEach(function (vendorLine) {
                                    if (vendorLine.SKIPPED) return;
                                    // Map vendor line data to standardized receipt line format
                                    vendorLines.push({
                                        ORDER_NUM: vendorLine.order_num,
                                        ORDER_STATUS: vendorLine.order_status,

                                        ORDER_DATE: vendorLine.order_date,
                                        SHIP_DATE: vendorLine.ship_date,
                                        ORDER_ETA: vendorLine.order_eta,
                                        ORDER_ETA_LIST: vendorLine.order_eta,
                                        DELIV_ETA: vendorLine.deliv_eta,
                                        DELIV_DATE: vendorLine.deliv_date,

                                        ITEM_TEXT: vendorLine.item_num,
                                        ITEM_ALT: vendorLine.item_num_alt,

                                        CARRIER: vendorLine.carrier,
                                        TRACKING_NUMS: vendorLine.tracking_num,
                                        SERIAL_NUMS: vendorLine.serial_num,
                                        // APPLIEDRATE: vendorLine.appliedrate,
                                        // Quantity and shipping status
                                        QUANTITY: vendorLine.ship_qty,
                                        IS_SHIPPED: vendorLine.is_shipped,
                                        NOTSHIPPED: vendorLine.NOTSHIPPED
                                    });
                                });

                                return vendorLines;
                            })()
                        };

                        ffresult = vcs_txnLib.createFulfillment(ffOption);
                        if (ffresult.hasError)
                            throw (
                                (ffresult && (ffresult.errorObj || ffresult.message)) ||
                                'Unknown fulfillment error'
                            );

                        vc2_util.log(logTitle, '... fulfillment result: ', ffresult);

                        if (ffresult.success) {
                            util.extend(orderNumUpdate, {
                                notes: 'Item Receipt Created',
                                orderNumValues: {
                                    ITEMFF_LINK: ffresult.id,
                                    NOTE: 'Item Receipt Created',
                                    DETAILS: ' '
                                }
                            });

                            vc2_util.vcLog({
                                title: 'Item Receipt | Successfully Created',
                                recordId: Current.poId,
                                successMsg: vc2_util.printSuccessLog({
                                    recordType: 'Item Receipt',
                                    recordId: ffresult.id,
                                    lines: (function () {
                                        var arrLines = [];

                                        (ffresult.Lines || []).forEach(function (line) {
                                            arrLines.push({
                                                Item: line.item_text,
                                                Qty: line.quantity,
                                                OrderNum: line.VENDORLINE.ORDER_NUM,
                                                Date: line.VENDORLINE.ORDER_DATE,
                                                ETA: line.VENDORLINE.ORDER_ETA || 'NA',
                                                Delivery: line.VENDORLINE.DELIV_DATE || 'NA',
                                                Shipped: line.VENDORLINE.SHIP_DATE || 'NA',
                                                Carrier: line.VENDORLINE.CARRIER || 'NA',
                                                Tracking: line.VENDORLINE.TRACKING_NUMS || 'NA',
                                                Serials: line.VENDORLINE.SERIAL_NUMS || 'NA'
                                            });
                                        });

                                        return arrLines;
                                    })()
                                })
                            });
                        }
                    } catch (fulfillmentError) {
                        var errorObj = vclib_error.log(logTitle, fulfillmentError);

                        vc2_util.vcLog({
                            title: 'Fulfillment Error | ' + orderData.VendorOrderNum,
                            warning: logPrefix + errorObj.errorMessage,
                            recordId: Current.poId
                        });

                        util.extend(orderNumUpdate, {
                            notes: errorObj.errorMessage,
                            orderNumValues: {
                                NOTE: errorObj.errorMessage,
                                DETAILS: ' '
                            }
                        });
                    } finally {
                        vc2_util.log(logTitle, '## Fulfillment Result: ', [
                            ffresult,
                            orderNumUpdate
                        ]);

                        // update the orderNum record
                        vcs_processLib.updateOrderNum(orderNumUpdate);

                        returnValue[orderData.VendorOrderNum] = ffresult;
                    }

                    return true;
                });
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error);

                vc2_util.vcLog({
                    title: 'Item Receipt Creation | Error',
                    error: errorObj.errorMessage,
                    recordId: Current.poId
                });

                Helper.updateOrderNumNotes({
                    poRec: Current.poRec,
                    poId: Current.poId,
                    orderNums: (function () {
                        var arrOrderNums = [];
                        option.orderData.forEach(function (orderData) {
                            arrOrderNums.push(orderData.VendorOrderNum);
                        });

                        return arrOrderNums;
                    })(),
                    notes: errorObj.errorMessage
                });

                returnValue = errorObj;
            }

            return returnValue;
        },
        processSerials: function (option) {
            var logTitle = [LogTitle, 'Helper.processSerial'].join('::'),
                returnValue,
                SERIAL_REC = vc2_constant.RECORD.SERIALS;

            try {
                var recordValues = {},
                    arrSearchCols = ['internalid', 'name'],
                    arrSerialFilters = [],
                    arrSerials = option.serials;

                if (vc2_util.isEmpty(arrSerials)) return false;

                // make the list unique
                arrSerials = vc2_util.uniqueArray(arrSerials);
                vc2_util.log(logTitle, '// Total serials: ', arrSerials.length);

                if (arrSerials.length > 250) {
                    var arrSerialsChunks = Helper.sliceArrayIntoChunks(arrSerials, 250);

                    arrSerialsChunks.forEach(function (chunkSerials) {
                        var chunkOption = option;
                        chunkOption.serials = chunkSerials;

                        vc2_util.serviceRequest({
                            moduleName: 'processV1',
                            action: 'processSerials',
                            parameters: chunkOption
                        });
                    });
                } else {
                    vcs_processLib.processSerials(option);
                }
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return true;
        },
        updateOrderNumNotes: function (option) {
            var logTitle = [LogTitle, 'updateOrderStatus'].join('::'),
                returnValue;

            try {
                var poRec = option.poRec,
                    poId = option.poId,
                    orderNums = option.orderNums,
                    orderNumNotes = option.notes;

                // either poRec or poId is required
                if (!poRec && !poId) throw 'Missing PO Record or PO ID';
                // orderLines and orderNumNotes are required
                if (!orderNums || !orderNumNotes) throw 'Missing Order Lines or Order Notes';

                orderNums.forEach(function (orderNum) {
                    vcs_processLib.updateOrderNum({
                        vendorNum: orderNum,
                        poId: poId || poRec.id,
                        orderNumValues: {
                            NOTE: orderNumNotes,
                            DETAILS: ' '
                        }
                    });
                });
            } catch (error) {
                returnValue = vclib_error.warn(logTitle, error);
            }

            return returnValue;
        },
        sliceArrayIntoChunks: function (array, chunkSize) {
            var chunks = [];
            for (var i = 0; i < array.length; i += chunkSize) {
                var chunk = array.slice(i, i + chunkSize);
                chunks.push(chunk);
            }
            return chunks;
        },

        getLineCount: function (option) {
            var logTitle = [LogTitle, 'getLineCount'].join('::');
            option = option || {};
            var returnValue = 0;

            try {
                ns_search
                    .create({
                        type: 'purchaseorder',
                        filters: [
                            ['internalid', 'is', option.poId],
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
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        },
        printSuccessLog: function (option) {
            var logTitle = [LogTitle, 'printSuccessLog'].join('::'),
                returnValue;

            var successMsg = [],
                recordType = option.recordType || 'Item Fulfillment',
                recordId = option.recordId,
                recordAction = option.recordAction || 'Created';

            successMsg.push(
                'Successfully ' +
                    recordAction.toLowerCase() +
                    ':  ' +
                    (recordType + ' [' + recordId + ']')
            );
            (option.lines || []).forEach(function (lineData, idx) {
                successMsg.push('\nLine #' + (idx + 1) + ': ');
                for (var lineKey in lineData) {
                    successMsg.push('  ' + lineKey + ': ' + lineData[lineKey]);
                }
            });

            returnValue = successMsg.join('\n');

            return returnValue;
        },

        forceDeploy: function (option) {
            var logTitle = [LogTitle, 'forceDeploy'].join('::');
            var returnValue = null;

            var FN = {
                randomStr: function (len) {
                    len = len || 5;
                    var str = new Date().getTime().toString();
                    return str.substring(str.length - len, str.length);
                },
                deploy: function (scriptId, deployId, scriptParams, taskType) {
                    var logTitle = [LogTitle, 'forceDeploy:deploy'].join('::');
                    var returnValue = false;

                    try {
                        var taskInfo = {
                            taskType: taskType,
                            scriptId: scriptId
                        };
                        if (deployId) taskInfo.deploymentId = deployId;
                        if (scriptParams) taskInfo.params = scriptParams;

                        var objTask = ns_task.create(taskInfo);

                        var taskId = objTask.submit();
                        var taskStatus = ns_task.checkStatus({
                            taskId: taskId
                        });

                        // check the status
                        vc2_util.log(logTitle, '## DEPLOY status: ', {
                            id: taskId,
                            status: taskStatus
                        });
                        returnValue = taskId;
                    } catch (e) {
                        vclib_error.log(logTitle, e);
                    }

                    return returnValue;
                },
                copyDeploy: function (scriptId) {
                    var logTitle = [LogTitle, 'forceDeploy:copyDeploy'].join('::');
                    var returnValue = false;
                    try {
                        var searchDeploy = ns_search.create({
                            type: ns_search.Type.SCRIPT_DEPLOYMENT,
                            filters: [
                                ['script.scriptid', 'is', scriptId],
                                'AND',
                                ['status', 'is', 'NOTSCHEDULED'],
                                'AND',
                                ['isdeployed', 'is', 'T']
                            ],
                            columns: ['scriptid']
                        });
                        var newDeploy = null;

                        searchDeploy.run().each(function (result) {
                            if (!result.id) return false;
                            newDeploy = ns_record.copy({
                                type: ns_record.Type.SCRIPT_DEPLOYMENT,
                                id: result.id
                            });

                            var newScriptId = result.getValue({ name: 'scriptid' });
                            newScriptId = newScriptId.toUpperCase().split('CUSTOMDEPLOY')[1];
                            newScriptId = [newScriptId.substring(0, 20), FN.randomStr()].join('_');

                            newDeploy.setValue({ fieldId: 'status', value: 'NOTSCHEDULED' });
                            newDeploy.setValue({ fieldId: 'isdeployed', value: true });
                            newDeploy.setValue({
                                fieldId: 'scriptid',
                                value: newScriptId.toLowerCase().trim()
                            });
                        });

                        return newDeploy
                            ? newDeploy.save({
                                  enableSourcing: false,
                                  ignoreMandatoryFields: true
                              })
                            : false;
                    } catch (e) {
                        vclib_error.log(logTitle, e);
                        throw e;
                    }
                },
                copyAndDeploy: function (scriptId, params, taskType) {
                    FN.copyDeploy(scriptId);
                    FN.deploy(scriptId, null, params, taskType);
                }
            };
            ////////////////////////////////////////
            try {
                if (!option.scriptId)
                    throw error.create({
                        name: 'MISSING_REQD_PARAM',
                        message: 'missing script id',
                        notifyOff: true
                    });

                if (!option.taskType) {
                    option.taskType = ns_task.TaskType.SCHEDULED_SCRIPT;
                    option.taskType = option.isMapReduce
                        ? ns_task.TaskType.MAP_REDUCE
                        : option.isSchedScript
                          ? ns_task.TaskType.SCHEDULED_SCRIPT
                          : option.taskType;
                }

                vc2_util.log(logTitle, '// params', option);

                returnValue =
                    FN.deploy(
                        option.scriptId,
                        option.deployId,
                        option.scriptParams,
                        option.taskType
                    ) ||
                    FN.deploy(option.scriptId, null, option.scriptParams, option.taskType) ||
                    FN.copyAndDeploy(option.scriptId, option.scriptParams, option.taskType);

                vc2_util.log(logTitle, '// deploy: ', returnValue);
            } catch (e) {
                vclib_error.log(logTitle, e);
                throw e;
            }
            ////////////////////////////////////////

            // initiate the cleanup
            // this.cleanUpDeployment(option);

            return returnValue;
        },
        cleanUpDeployment: function (option) {
            var logTitle = [LogTitle, 'cleanUpDeployment'].join('::');

            var searchDeploy = ns_search.create({
                type: ns_search.Type.SCRIPT_DEPLOYMENT,
                filters: [
                    ['script.scriptid', 'is', option.scriptId],
                    'AND',
                    ['status', 'is', 'NOTSCHEDULED'],
                    'AND',
                    ['isdeployed', 'is', 'T']
                ],
                columns: ['scriptid']
            });

            var maxAllowed = option.max || MAX_NO_DEPLOYMENTS; // only allow 100
            var arrResults = vc2_util.searchGetAllResult(searchDeploy);

            vc2_util.log(logTitle, '>> cleanup : ', {
                maxAllowed: maxAllowed,
                totalResults: arrResults.length
            });
            if (maxAllowed > arrResults.length) return;

            var currentScript = ns_runtime.getCurrentScript();
            var countDelete = arrResults.length - maxAllowed;
            var idx = 0;

            while (countDelete-- && currentScript.getRemainingUsage() > 100) {
                try {
                    ns_record.delete({
                        type: ns_record.Type.SCRIPT_DEPLOYMENT,
                        id: arrResults[idx++].id
                    });
                } catch (del_err) {}
            }
            vc2_util.log(logTitle, '// Total deleted: ', idx);

            return true;
        }
    };

    return MAP_REDUCE;
});
