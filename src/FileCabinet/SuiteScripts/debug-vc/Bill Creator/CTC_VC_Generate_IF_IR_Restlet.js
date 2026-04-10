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
 * Script Name: CTC VC | Generate IF/IR RL
 * Script ID: customscript_vc_if_ir_restlet
 *
 * @author brianf@nscatalyst.com
 * @description Bill Creator Restlet that generates Item Fulfillments/Receipts based on bill payload data.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-16   brianf                Fixed undefined util.extend on line 77; standardized entry-point naming to Endpoint
 * 2026-02-27   brianf                Updated script header for standards compliance
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType Restlet
 */
define(function (require) {
    var ns_record = require('N/record'),
        ns_search = require('N/search'),
        ns_runtime = require('N/runtime'),
        ns_util = require('N/util'),
        ns_format = require('N/format');

    var vc2_constant = require('./../CTC_VC2_Constants'),
        vc2_util = require('./../CTC_VC2_Lib_Utils'),
        vc2_recordlib = require('./../CTC_VC2_Lib_Record'),
        vc_nslib = require('./../CTC_VC_Lib_Record.js');

    var moment = require('./Libraries/moment');
    var vcs_configLib = require('./../Services/ctc_svclib_configlib.js'),
        vcs_txnLib = require('./../Services/ctc_svclib_transaction.js'),
        vcs_recordLib = require('./../Services/ctc_svclib_records.js'),
        vcs_billCreateLib = require('./../Services/ctc_svclib_billcreate.js'),
        vcs_processLib = require('./../Services/ctc_svclib_process-v1.js');

    var vc_billprocess = require('./Libraries/CTC_VC_Lib_BillProcess');

    var LogTitle = 'VC|Generate IF/IR',
        VCLOG_APPNAME = 'VAR Connect | Process Bill (IF)',
        Current = {},
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

    var orderLineFields = [
        'item',
        'quantity',
        'rate',
        'amount',
        'custcol_ctc_xml_dist_order_num',

        'custcol_ctc_xml_date_order_placed',
        'custcol_ctc_vc_order_placed_date',
        'custcol_ctc_vc_shipped_date',
        'custcol_ctc_vc_eta_date',
        'custcol_ctc_xml_ship_date',
        'custcol_ctc_xml_eta',
        //
        'custcol_ctc_xml_carrier',
        'custcol_ctc_xml_tracking_num',
        'custcol_ctc_xml_inb_tracking_num',
        'custcol_ctc_xml_serial_num'
    ];

    var Endpoint = {
        post: function (context) {
            var logTitle = [LogTitle, 'POST'].join('::'),
                returnObj = {};

            vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

            try {
                vc2_util.log(logTitle, '**** START SCRIPT **** ', context);

                ns_util.extend(Current, {
                    poId: context.PO_LINK,
                    billFileId: context.ID,
                    isRecievable: context.IS_RCVBLE,
                    billPayload: vc2_util.safeParse(context.JSON)
                });
                vc2_util.LogPrefix = '[purchaseorder:' + Current.poId + '] ';
                vc2_util.log(logTitle, '// Current Data: ', Current);
                if (!Current.poId) throw 'Purchase Order Required';

                // load the bill file
                if (!Current.billFileId) throw 'Bill File ID is required';
                var BillFileRec = vcs_billCreateLib.loadBillFile({
                    billFileId: Current.billFileId
                });

                vc2_util.vcLog({
                    title: 'BillCreator | Fulfillment - Bill File Payload',
                    // Fixed: log bill payload only when present to avoid noisy undefined entries.
                    content: JSON.stringify(Current.billPayload || BillFileRec.JSON || {}),
                    recordId: Current.poId
                });

                if (!Current.isRecievable)
                    throw 'This Vendor is not enabled for Auto Receipts/Fulfillments';

                Current.PO_REC = vcs_recordLib.load({
                    type: 'purchaseorder',
                    id: Current.poId,
                    isDynamic: true
                });

                Current.PO_DATA = vcs_recordLib.extractValues({
                    record: Current.PO_REC,
                    columns: [
                        'tranid',
                        'entity',
                        'dropshipso',
                        'status',
                        'statusRef',
                        'createdfrom',
                        'subsidiary',
                        'custbody_ctc_po_link_type',
                        'custbody_isdropshippo'
                    ]
                });

                vc2_util.log(logTitle, '// PO Data: ', Current.PO_DATA);

                if (Current.PO_DATA.createdfrom) {
                    Current.SO_DATA = vc2_util.flatLookup({
                        type: ns_search.Type.SALES_ORDER,
                        id: Current.PO_DATA.createdfrom,
                        columns: ['entity', 'tranid']
                    });
                    vc2_util.log(logTitle, '// SO Data: ', Current.SO_DATA);
                }

                var isDropPO =
                    Current.PO_DATA.dropshipso ||
                    Current.PO_DATA.custbody_ctc_po_link_type == 'Dropship' ||
                    Current.PO_DATA.custbody_isdropshippo;

                vc2_util.log(logTitle, '// PO_DATA: ', Current.PO_DATA);

                if (!isDropPO) throw 'Not a Drop Ship Order';

                var MainCFG = vcs_configLib.mainConfig(),
                    BillCFG = vcs_configLib.billVendorConfig({ poId: Current.poId }),
                    OrderCFG = vcs_configLib.orderVendorConfig({ poId: Current.poId });

                if (!BillCFG.enableFulfillment)
                    throw 'This Vendor is not enabled for Auto Receipts/Fulfillments';

                // search for the bill file
                var searchResults = vcs_recordLib.searchTransactions({
                    filters: [
                        ['externalid', 'is', 'ifir_' + BillFileRec.BILL_NUM],
                        'AND',
                        ['type', 'anyof', 'ItemShip', 'ItemRcpt']
                    ]
                });
                if (searchResults.length > 0) {
                    // Fixed: use N/util module reference instead of undefined global util.
                    ns_util.extend(returnObj, {
                        msg: 'Fulfillment/Receipt Already Exists',
                        id: searchResults[0].id
                    });
                    return returnObj;
                }

                var ffOption = {
                    poRec: Current.PO_REC,
                    poId: Current.poId,
                    mainConfig: MainCFG,
                    vendorConfig: OrderCFG,
                    billConfig: BillCFG,
                    headerValues: {
                        externalid: 'ifir_' + BillFileRec.BILL_NUM,
                        tranid: BillFileRec.BILL_NUM,
                        custbody_ctc_if_vendor_order_match: BillFileRec.BILL_NUM,
                        // shipstatus: 'C', // 'Shipped'
                        custbody_ctc_vc_createdby_vc: true,
                        trandate: (function () {
                            var shipDate =
                                BillFileRec.JSON.shipDate && BillFileRec.JSON.shipDate != 'NA'
                                    ? BillFileRec.JSON.shipDate
                                    : BillFileRec.JSON.date;

                            var nsShipDate = ns_format.parse({
                                value: moment(shipDate).toDate(),
                                type: ns_format.Type.DATE
                            });

                            vc2_util.log(logTitle, '... shipDate: ', [shipDate, nsShipDate]);
                            return nsShipDate;
                        })()
                    },
                    vendorLines: (function () {
                        /// prepare the lines for fulfillment
                        BillFileRec.LINES.forEach(function (payloadLine) {
                            // Fixed: use N/util module reference instead of undefined global util.
                            ns_util.extend(payloadLine, {
                                ORDER_NUM: '',
                                ORDER_STATUS: '',
                                ORDER_DATE: '',
                                ORDER_ETA: '',
                                ORDER_DELIV: '',
                                IS_SHIPPED: true,
                                SHIP_METHOD: BillFileRec.JSON.carrier,
                                SHIP_DATE: BillFileRec.JSON.shipDate || BillFileRec.JSON.date,
                                CARRIER: BillFileRec.JSON.carrier,
                                TRACKING_NUMS: payloadLine.TRACKING,
                                SERIAL_NUMS: payloadLine.SERIAL,
                                ITEM_TEXT: payloadLine.NSITEM_NAME || payloadLine.ITEMNO,
                                APPLIEDRATE: payloadLine.BILLRATE || payloadLine.PRICE
                            });

                            return true;
                        });

                        return BillFileRec.LINES;
                    })(),
                    onValidateError: function () {}
                };

                var ffResult = vcs_txnLib.createFulfillment(ffOption);
                vc2_util.log(logTitle, '... itemFFData: ', ffResult);
                if (ffResult.hasError) {
                    // check if the error is no fulfillable lines
                    var errorCode = ffResult.transformValidation
                            ? ffResult.transformValidation.errorCode
                            : ffResult.errorCode,
                        errorMsg = ffResult.transformValidation
                            ? ffResult.transformValidation.errorMessage
                            : ffResult.errorMessage;

                    if (errorCode == 'NO_FULFILLABLE_LINES') {
                        // Fixed: use N/util module reference instead of undefined global util.
                        ns_util.extend(returnObj, {
                            msg: ffResult.errorMessage || 'No Fulfillable Lines Found',
                            errorCode: ffResult.errorCode || 'NO_FULFILLABLE_LINES'
                        });

                        return returnObj;
                    }

                    // else throw the error
                    throw ffResult.errorMessage || 'Fulfillment Error';
                }

                if (!vc2_util.isEmpty(ffResult.Serials)) {
                    ffResult.Serials.forEach(function (serialData) {
                        vcs_processLib.processSerials(serialData);
                    });
                }

                // Fixed: use N/util module reference instead of undefined global util.
                ns_util.extend(returnObj, {
                    id: ffResult.id,
                    itemff: ffResult.id,
                    msg: 'Created Item Fulfillment [itemfulfillment:' + ffResult.id + ']',
                    serialData: {
                        poId: Current.poId,
                        soId: Current.PO_DATA.createdfrom,
                        // Fixed: guard SO lookup data to prevent runtime errors when createdfrom is empty/unavailable.
                        custId:
                            Current.SO_DATA &&
                            Current.SO_DATA.entity &&
                            Current.SO_DATA.entity.value
                                ? Current.SO_DATA.entity.value
                                : null,
                        type: 'if',
                        trxId: ffResult.id,
                        lines: ffResult.Serials
                    }
                });

                /// LOG THE SUCESSFUL FULFILLMENT //
                vc2_util.vcLog({
                    title: 'Fulfillment | Successfully Created',
                    successMsg: vc2_util.printSuccessLog({
                        recordType: 'Item Fulfillment',
                        recordId: ffResult.id, // corrected from ffresult.id to ffResult.id
                        lines: (function () {
                            var arrLines = [];

                            (ffResult.Lines || []).forEach(function (line) {
                                // corrected from ffresult.Lines to ffResult.Lines
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
                    }),
                    recordId: Current.poId
                });
            } catch (error) {
                vc2_util.logError(logTitle, error);

                // Fixed: use N/util module reference instead of undefined global util.
                ns_util.extend(returnObj, {
                    msg: vc2_util.extractError(error),
                    logstatus: LOG_STATUS.RECORD_ERROR,
                    isError: true
                });

                vc2_util.vcLog({
                    title: 'BillCreator | Fulfillment Error',
                    error: error,
                    // Fixed: send an explicit, reliable detail payload to log records.
                    details: returnObj.msg,
                    status: returnObj.logstatus,
                    recordId: Current.poId
                });
            } finally {
                vc2_util.log(logTitle, '## EXIT SCRIPT ## ', returnObj);
            }

            return returnObj;
        }
    };

    return Endpoint;
});
