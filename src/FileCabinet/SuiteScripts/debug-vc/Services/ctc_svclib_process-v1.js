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
 * Script Name: VC Services | Process-v1 Library
 *
 * @author brianf@nscatalyst.com
 * @description Service layer for normalizing and persisting vendor data to VC custom records.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-28   brianf        Replaced purgeInactiveOrderStatusLines with searchInactiveOrderNums and searchInactiveOrderLines; removed unused
 *                            LOG_APP variable; fixed serialSarchObj typo; standardized all logTitle separators to '::'; removed unused vars in
 *                            updateOrderNum and updateMatchedLine; fixed updateMatchedLine logTitle to match function name
 * 2026-03-27   brianf        Migrated from legacy vc2_util/vc2_constant to vclib_utils/vclib_constants; updated cleanupOrderStatusLines to use
 *                            vcs_recordLib.searchRecord for >1000 line support, preserve ORDER_NUM records with fulfillment links, and inactivate
 *                            records instead of deleting; removed unused ns_util import; updated bulkDeleteOrderStatusLines to inactivate instead of
 *                            delete; added bulkUpdateOrderDetailLines and bulkProcessSerials methods; added unmapped field guards in addOrderNumRec
 *                            and addOrderLineRec
 * 2026-03-20   brianf        Removed standalone inline comments from file; preserved JSDoc, copyright header, and all code/logging statements
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'SVC:VCProcess';

    var ns_search = require('N/search'),
        ns_record = require('N/record');

    var vclib_utils = require('./lib/ctc_lib_utils.js'),
        vclib_constants = require('./lib/ctc_lib_constants.js'),
        vclib_error = require('./lib/ctc_lib_error.js');

    var vcs_configLib = require('./ctc_svclib_configlib'),
        vcs_recordLib = require('./ctc_svclib_records');

    var Helper = {
        addOrderNumRec: function (option) {
            var logTitle = [LogTitle, 'addOrderNumRec'].join('::'),
                returnValue,
                ORDNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDNUM_FLD = ORDNUM_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum,
                    recordData = option.recordData,
                    orderNumRec = option.orderNumRec;

                if (!recordData) {
                    recordData = vcs_recordLib.searchTransaction({
                        poNum: poNum,
                        poId: poId
                    });
                    if (vclib_utils.isEmpty(recordData)) {
                        vclib_utils.logWarn(
                            logTitle,
                            'No record data found for PO ID: ' + (poId || poNum)
                        );
                        return false;
                    }
                }

                var recordValues = {
                    TXN_LINK: recordData.id,
                    ORDER_NUM: poNum || recordData.tranid,
                    VENDOR_NUM: option.VendorOrderNum,
                    ORDER_DATE: vclib_utils.momentParse(option.OrderDate),
                    SHIPPED_DATE: vclib_utils.momentParse(option.ShippedDate),
                    ETA_DATE: vclib_utils.momentParse(option.ETA),
                    DELIV_ETA: vclib_utils.momentParse(option.ETD),
                    DELIV_DATE: vclib_utils.momentParse(option.DelivDate),

                    TOTAL: vclib_utils.parseFloat(option.Total == 'NA' ? 0 : option.Total),
                    SOURCE: !util.isString(option.Source)
                        ? JSON.stringify(option.Source)
                        : option.Source,
                    ORDER_STATUS: option.Status,
                    LINES: JSON.stringify(option.Lines),
                    VENDOR: option.ConfigRec ? option.ConfigRec.xmlVendor : null,
                    VENDOR_CFG: option.ConfigRec ? option.ConfigRec.id : null,

                    QUOTE: option.QuoteOrderNum
                };

                if (!orderNumRec) {
                    var recOrderNum = ns_record.create({ type: ORDNUM_REC.ID });
                    for (var fld in recordValues) {
                        if (!ORDNUM_FLD[fld]) {
                            vclib_utils.logWarn(
                                logTitle,
                                'Skipping unmapped ORDER_NUM field: ' + fld
                            );
                            continue;
                        }
                        recOrderNum.setValue({
                            fieldId: ORDNUM_FLD[fld],
                            value: recordValues[fld]
                        });
                    }
                    recOrderNum.setValue({ fieldId: 'name', value: recordValues.VENDOR_NUM });

                    var orderNumRecID = recOrderNum.save();
                    orderNumRec = util.extend(recordValues, { ID: orderNumRecID });
                    vclib_utils.log(logTitle, '/// Created new record --', orderNumRec);
                } else {
                    var submitRecOption = {
                        type: ORDNUM_REC.ID,
                        id: orderNumRec.ID,
                        values: (function () {
                            var fldValues = {};
                            for (var fld in recordValues)
                                fldValues[ORDNUM_FLD[fld]] = recordValues[fld];
                            return fldValues;
                        })()
                    };
                    ns_record.submitFields(submitRecOption);
                }
                returnValue = orderNumRec;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        addOrderLineRec: function (option) {
            var logTitle = [LogTitle, 'addOrderLineRec'].join('::'),
                returnValue,
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum,
                    orderLineData = option.orderLineData,
                    orderNumRec = option.orderNumRec,
                    orderLineRec = option.orderLineRec;

                var recordLineValues = {
                    ORDNUM_LINK: orderNumRec.ID,
                    VENDOR: orderNumRec.VENDOR,
                    TXN_LINK: orderNumRec.TXN_LINK,
                    ORDER_NUM: orderLineData.order_num,
                    ORDER_STATUS: orderLineData.order_status,
                    LINE_STATUS: orderLineData.line_status,
                    ITEM: orderLineData.item_num,
                    SKU: orderLineData.vendorSKU,
                    LINE_NO: orderLineData.line_num,
                    VNDLINE: orderLineData.vendor_lineno,
                    ORDER_TYPE: orderLineData.order_type,
                    MAIN_ITEM: !!orderLineData.main_item,
                    QTY:
                        !vclib_utils.isEmpty(orderLineData.ship_qty) &&
                        orderLineData.ship_qty !== 'NA'
                            ? orderLineData.ship_qty
                            : 0,
                    ORDER_DATE: vclib_utils.momentParse(orderLineData.order_date),
                    SHIPPED_DATE: vclib_utils.momentParse(orderLineData.ship_date),
                    ETA_DATE: vclib_utils.momentParse(orderLineData.order_eta),
                    ETD_DATE: vclib_utils.momentParse(orderLineData.deliv_eta),
                    PROMISED_DATE: vclib_utils.momentParse(orderLineData.prom_date),
                    CARRIER: orderLineData.carrier,
                    SHIP_METHOD: orderLineData.ship_method,
                    TRACKING: orderLineData.tracking_num,
                    SERIALNUM: Helper.limitSerialChar(orderLineData.serial_num, 3900),
                    ORDER_DATA: orderLineData.order_data,
                    SHIP_STATUS: (function () {
                        return orderLineData.is_shipped
                            ? 'SHIPPED'
                            : orderLineData.SKIPPED || orderLineData.NOTSHIPPED;
                    })(),
                    SUBSCRIPTION_ID: orderLineData.subscription_id,
                    SERVICE_START_DATE: vclib_utils.momentParse(orderLineData.req_start_date),
                    ETA_SERV_START_DATE: vclib_utils.momentParse(orderLineData.est_start_date),
                    START_DATE: vclib_utils.momentParse(orderLineData.start_date),
                    END_DATE: vclib_utils.momentParse(orderLineData.end_date),
                    TERM: orderLineData.term,
                    RENEWAL_TERM: orderLineData.renewal_term,
                    BILLING_MODEL: orderLineData.billing_model
                };
                recordLineValues.RECKEY = [
                    recordLineValues.TXN_LINK,
                    recordLineValues.VENDOR,
                    recordLineValues.ORDER_NUM
                ].join('_');

                if (!orderLineRec || vclib_utils.isEmpty(orderLineRec)) {
                    var recOrderLine = ns_record.create({ type: ORDLINE_REC.ID });

                    for (var fld in recordLineValues) {
                        if (!ORDLINE_FLD[fld]) {
                            vclib_utils.logWarn(
                                logTitle,
                                'Skipping unmapped ORDER_LINE field: ' + fld
                            );
                            continue;
                        }
                        recOrderLine.setValue({
                            fieldId: ORDLINE_FLD[fld],
                            value: recordLineValues[fld]
                        });
                    }
                    recOrderLine.setValue({ fieldId: 'name', value: recordLineValues.LINE_NO });
                    returnValue = recOrderLine.save();

                    vclib_utils.log(logTitle, '/// Created new record.');
                } else {
                    var submitRecOption = {
                        type: ORDLINE_REC.ID,
                        id: orderLineRec.ID,
                        values: (function () {
                            var fldValues = {};
                            for (var fld in recordLineValues)
                                fldValues[ORDLINE_FLD[fld]] = recordLineValues[fld];
                            return fldValues;
                        })()
                    };
                    returnValue = ns_record.submitFields(submitRecOption);
                }
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        searchOrderNum: function (option) {
            var logTitle = [LogTitle, 'searchOrderNum'].join('::'),
                returnValue,
                ORDNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDNUM_FLD = ORDNUM_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum,
                    vendorNum = option.vendorNum,
                    orderNumRecId = option.orderNumRecId;

                if (!poId && !poNum) {
                    vclib_utils.logWarn(logTitle, 'No PO ID or PO Number provided');
                    return;
                }

                var searchOption = {
                    type: ORDNUM_REC.ID,
                    filters: (function () {
                        var fltr = [['isinactive', 'is', 'F']];
                        if (poId) fltr.push('AND', [ORDNUM_FLD.TXN_LINK, 'anyof', poId]);
                        if (poNum) fltr.push('AND', [ORDNUM_FLD.ORDER_NUM, 'is', poNum]);
                        if (vendorNum) fltr.push('AND', [ORDNUM_FLD.VENDOR_NUM, 'is', vendorNum]);
                        if (orderNumRecId) fltr.push('AND', ['internalid', 'anyof', orderNumRecId]);
                        return fltr;
                    })(),
                    columns: (function () {
                        var cols = ['internalid', 'name'];
                        for (var fld in ORDNUM_FLD) cols.push(ORDNUM_FLD[fld]);
                        return cols;
                    })()
                };

                var OrderNumSearch = ns_search.create(searchOption);

                if (!OrderNumSearch.runPaged().count) {
                    vclib_utils.logWarn(logTitle, 'No OrderNum records found');
                    return;
                }

                var OrderNumData = {};
                OrderNumSearch.run().each(function (searchRow) {
                    OrderNumData.ID = searchRow.id;
                    OrderNumData.NAME = searchRow.getValue({ name: 'name' });
                    for (var fld in ORDNUM_FLD) {
                        var value = searchRow.getValue({ name: ORDNUM_FLD[fld] }),
                            textValue = searchRow.getText({ name: ORDNUM_FLD[fld] });

                        OrderNumData[fld] = value;
                        if (textValue && textValue != value)
                            OrderNumData[fld + '_text'] = textValue;
                    }
                    return true;
                });

                returnValue = OrderNumData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        searchOrderLines: function (option) {
            var logTitle = [LogTitle, 'searchOrderLines'].join('::'),
                returnValue,
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum,
                    vendorNum = option.vendorNum,
                    orderNumRecId = option.orderNumRecId;

                if (!poId && !poNum) {
                    vclib_utils.logWarn(logTitle, 'No PO ID or PO Number provided');
                    return;
                }

                var searchOption = {
                    type: ORDLINE_REC.ID,
                    filters: (function () {
                        var fltr = [['isinactive', 'is', 'F']];
                        if (poId) fltr.push('AND', [ORDLINE_FLD.TXN_LINK, 'anyof', poId]);
                        if (vendorNum) fltr.push('AND', [ORDLINE_FLD.ORDER_NUM, 'is', vendorNum]);
                        if (orderNumRecId)
                            fltr.push('AND', [ORDLINE_FLD.ORDNUM_LINK, 'anyof', orderNumRecId]);
                        return fltr;
                    })(),
                    columns: (function () {
                        var cols = ['internalid'];
                        for (var fld in ORDLINE_FLD) cols.push(ORDLINE_FLD[fld]);
                        return cols;
                    })()
                };

                var OrderLineSearch = ns_search.create(searchOption);

                if (!OrderLineSearch.runPaged().count) {
                    vclib_utils.logWarn(logTitle, 'No OrderLine records found');
                    return false;
                }

                var OrderLineData = [];
                OrderLineSearch.run().each(function (searchRow) {
                    var orderLine = {
                        ID: searchRow.id,
                        NAME: searchRow.getValue({ name: 'name' })
                    };
                    for (var fld in ORDLINE_FLD) {
                        var value = searchRow.getValue({ name: ORDLINE_FLD[fld] }),
                            textValue = searchRow.getText({ name: ORDLINE_FLD[fld] });

                        orderLine[fld] = value;
                        if (textValue && textValue != value) orderLine[fld + '_text'] = textValue;
                    }
                    OrderLineData.push(orderLine);
                    return true;
                });

                returnValue = OrderLineData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        cleanupOrderNum: function (option) {
            var logTitle = [LogTitle, 'Helper:cleanupOrderNum'].join('::'),
                returnValue;

            try {
                var orderNum =
                        option.orderNum ||
                        option.VendorOrderNum ||
                        !vclib_utils.isEmpty(option.orderNumRec)
                            ? option.orderNumRec.NAME || option.orderNumRec.VENDOR_NUM
                            : null,
                    orderNumID =
                        option.orderNumID ||
                        option.orderNumRecID ||
                        option.id ||
                        !vclib_utils.isEmpty(option.orderNumRec)
                            ? option.orderNumRec.ID
                            : null;

                if (!orderNumID && !orderNum) {
                    vclib_utils.logWarn(logTitle, 'No OrderNum record provided.');
                    return false;
                }

                vclib_utils.log(logTitle, '### CLEANUP ORDER NUM ### ', [orderNum, orderNumID]);

                if (!orderNumID) {
                    var orderNumRec = Helper.searchOrderNum({
                        poId: option.poId,
                        poNum: option.poNum,
                        vendorNum: orderNum
                    });
                    orderNumID = orderNumRec.ID;
                }
                if (!orderNumID) {
                    vclib_utils.logWarn(logTitle, 'No OrderNum record found for cleanup.');
                    return false;
                }

                var orderLines = Helper.searchOrderLines({
                    orderNumRecId: option.orderNumRec.ID,
                    vendorNum: orderNum,
                    poId: option.poId,
                    poNum: option.poNum
                });

                (orderLines || []).forEach(function (orderLine) {
                    Helper.cleanupOrderLine({ orderLineId: orderLine.ID });
                });

                var submitRecOption = {
                    type: vclib_constants.RECORD.ORDER_NUM.ID,
                    id: orderNumID,
                    values: (function () {
                        var updateValues = { isinactive: true };
                        updateValues[vclib_constants.RECORD.ORDER_NUM.FIELD.ORDER_STATUS] =
                            'DELETED';
                        return updateValues;
                    })()
                };
                ns_record.submitFields(submitRecOption);
                vclib_utils.log(
                    logTitle,
                    '/// OrderNum record status set to DELETED -- ',
                    submitRecOption
                );
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        cleanupOrderLine: function (option) {
            var logTitle = [LogTitle, 'Helper:cleanupOrderLine'].join('::'),
                returnValue;

            try {
                vclib_utils.log(logTitle, '### CLEANUP ORDER LINES ### ', option);

                var orderLineID = option.orderLineId || option.orderLineRecID || option.id;
                if (!vclib_utils.isEmpty(option.orderLineRec)) orderLineID = option.orderLineRec.ID;
                if (!orderLineID) {
                    vclib_utils.logWarn(logTitle, 'No OrderLine record provided.');
                    return false;
                }

                var submitRecOption = {
                    type: vclib_constants.RECORD.ORDER_LINE.ID,
                    id: orderLineID,
                    values: (function () {
                        var updateValues = { isinactive: true };
                        updateValues[vclib_constants.RECORD.ORDER_LINE.FIELD.LINE_STATUS] =
                            'DELETED';
                        return updateValues;
                    })()
                };
                ns_record.submitFields(submitRecOption);
                vclib_utils.log(
                    logTitle,
                    '/// OrderLine record status set to DELETED -- ',
                    submitRecOption
                );
                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        limitSerialChar: function (str, maxLen) {
            if (typeof str !== 'string' || !maxLen || maxLen <= 0) return '';
            if (str.length <= maxLen) return str;

            var parts = str.split(',');
            var out = '';
            for (var i = 0; i < parts.length; i++) {
                var token = parts[i].trim(); // remove accidental spaces
                if (!token) continue;

                var candidate = out ? out + ',' + token : token;
                if (candidate.length <= maxLen) {
                    out = candidate;
                } else {
                    break;
                }
            }
            if (str.length > maxLen) {
                out += ', more..';
            }
            return out;
        }
    };

    var LibProcess = {};

    util.extend(LibProcess, {
        processSerials: function (option) {
            var logTitle = [LogTitle, 'processSerials'].join('::'),
                returnValue,
                SERIAL_REC = vclib_constants.RECORD.SERIALS;

            var recordValues = {},
                arrSearchCols = ['internalid', 'name'],
                arrSerialFilters = [],
                arrSerials = option.serials;

            if (vclib_utils.isEmpty(arrSerials)) return false;

            arrSerials = vclib_utils.uniqueArray(arrSerials);

            vclib_utils.log(logTitle, '// Total serials: ', arrSerials.length);

            for (var fld in SERIAL_REC.FIELD) {
                if (option[fld] == null) continue;
                recordValues[SERIAL_REC.FIELD[fld]] = option[fld];
                arrSearchCols.push(SERIAL_REC.FIELD[fld]);
            }
            vclib_utils.log(logTitle, '>> record data: ', recordValues);

            var searchOption = {
                type: SERIAL_REC.ID,
                filters: [['isinactive', 'is', 'F']],
                columns: arrSearchCols
            };

            arrSerials.forEach(function (serial) {
                if (arrSerialFilters.length) arrSerialFilters.push('OR');
                arrSerialFilters.push(['name', 'is', serial]);
                return true;
            });

            searchOption.filters.push(
                'AND',
                arrSerialFilters.length > 1 ? arrSerialFilters : arrSerialFilters.shift()
            );

            var serialSearchObj = ns_search.create(searchOption);
            vclib_utils.log(
                logTitle,
                '>> Total existing serials: ',
                serialSearchObj.runPaged().count
            );

            var arrUpdatedSerial = [],
                arrAddedSerial = [],
                arrProcessedSerial = [];

            var cnt = 0;
            serialSearchObj.run().each(function (searchRow) {
                var serialNum = searchRow.getValue({ name: 'name' });
                ns_record.submitFields({
                    type: SERIAL_REC.ID,
                    id: searchRow.id,
                    values: recordValues,
                    options: { enablesourcing: true }
                });
                arrUpdatedSerial.push(serialNum);
                arrProcessedSerial.push(serialNum);

                vclib_utils.log(logTitle, '>> Updated Serial: ', [
                    [cnt++, arrSerials.length].join('/'),
                    serialNum,
                    searchRow.id,
                    recordValues
                ]);
                return true;
            });

            arrSerials.forEach(function (serial) {
                if (vclib_utils.inArray(serial, arrUpdatedSerial)) return;

                var recSerial = ns_record.create({ type: SERIAL_REC.ID });
                recSerial.setValue({ fieldId: 'name', value: serial });

                for (var fld in recordValues) {
                    if (!fld) {
                        vclib_utils.logWarn(logTitle, 'Skipping empty field ID for SERIAL record');
                        continue;
                    }
                    recSerial.setValue({ fieldId: fld, value: recordValues[fld] });
                }
                var serialId = recSerial.save();

                vclib_utils.log(logTitle, '>> New Serial ID: ', [
                    [cnt++, arrSerials.length].join('/'),
                    serial,
                    recordValues,
                    serialId
                ]);

                arrAddedSerial.push(serial);
                arrProcessedSerial.push(serial);
            });

            vclib_utils.log(logTitle, '...total processed serials: ', {
                recordValues: recordValues,
                processed: arrProcessedSerial.length,
                added: arrAddedSerial.length,
                updated: arrUpdatedSerial.length
            });

            return true;
        },
        prepareSerialsFromOrderLines: function (option) {
            var logTitle = [LogTitle, 'prepareSerialsFromOrderLines'].join('::'),
                returnValue,
                arrSerialData = [];
            try {
                var orderLines = option.orderLines || option.lines,
                    poId = option.poId || option.purchaseOrderId,
                    soId = option.soId || option.salesOrderId,
                    customerId = option.customerId,
                    itemff = option.itemff || option.itemFulfillmentId;
                if (vclib_utils.isEmpty(orderLines)) return false;

                orderLines.forEach(function (lineData) {
                    var serialNums = lineData.serial_num;
                    if (!serialNums || serialNums == 'NA') return; // skip non serials
                    serialNums = serialNums.split(',');

                    var itemId = lineData.ITEM_LINK || lineData.item_id;

                    var serialData = { serials: serialNums };
                    if (itemId) serialData.ITEM = itemId;
                    if (poId) serialData.PURCHASE_ORDER = poId;
                    if (soId) serialData.SALES_ORDER = soId;
                    if (customerId) serialData.CUSTOMER = customerId;
                    if (itemff) serialData.ITEM_FULFILLMENT = itemff;

                    arrSerialData.push(serialData);
                    return true;
                });
                returnValue = arrSerialData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }
            return returnValue;
        }
    });

    util.extend(LibProcess, {
        searchOrderLines: function (option) {
            var logTitle = [LogTitle, 'searchOrderLines'].join('::'),
                returnValue,
                ORDNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDNUM_FLD = ORDNUM_REC.FIELD,
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD;

            try {
                var vendorNum = option.vendorNum || option.VendorOrderNum,
                    orderNumRecId = option.id || option.orderNumRecID,
                    poId = option.poId || option.purchaseOrderId,
                    orderKey = option.orderKey,
                    poNum = option.poNum || option.tranid;

                if (!(vendorNum && (poId || poNum)) && !orderKey && !orderNumRecId) {
                    vclib_utils.logWarn(logTitle, 'No Vendor Number or Order Key provided');
                    return false;
                }

                var OrderNumData = Helper.searchOrderNum({
                    poId: poId,
                    poNum: poNum,
                    vendorNum: vendorNum,
                    orderNumRecId: orderNumRecId
                });
                if (!OrderNumData) {
                    vclib_utils.logWarn(logTitle, 'No OrderNum Data found.');
                    return false;
                }

                OrderNumData.LINES = Helper.searchOrderLines({
                    orderNumRecId: OrderNumData.ID,
                    vendorNum: vendorNum,
                    poId: poId,
                    poNum: poNum
                });

                returnValue = OrderNumData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        searchOrderLine: function (option) {
            var logTitle = [LogTitle, 'searchOrderLine'].join('::'),
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                returnValue;

            try {
                var poId = option.poId,
                    vendorLine = option.vendorLine;

                var searchOption = {
                    type: ORDLINE_REC.ID,
                    filters: (function () {
                        var fltr = [['isinactive', 'is', 'F']];
                        if (poId) fltr.push('AND', [ORDLINE_FLD.TXN_LINK, 'anyof', poId]);
                        if (vendorLine) {
                            if (vendorLine.item_num)
                                fltr.push('AND', [ORDLINE_FLD.ITEM, 'is', vendorLine.item_num]);

                            if (vendorLine.order_num && vendorLine.order_num !== 'NA')
                                fltr.push('AND', [
                                    ORDLINE_FLD.ORDER_NUM,
                                    'is',
                                    vendorLine.order_num
                                ]);
                            if (vendorLine.line_num && vendorLine.line_num !== 'NA')
                                fltr.push('AND', [ORDLINE_FLD.LINE_NO, 'is', vendorLine.line_num]);

                            if (vendorLine.line_status && vendorLine.line_status !== 'NA')
                                fltr.push('AND', [
                                    ORDLINE_FLD.LINE_STATUS,
                                    'is',
                                    vendorLine.line_status
                                ]);

                            if (!vclib_utils.isEmpty(vendorLine.ship_qty))
                                fltr.push('AND', [ORDLINE_FLD.QTY, 'is', vendorLine.ship_qty]);
                        }
                        return fltr;
                    })(),
                    columns: (function () {
                        var cols = ['internalid'];
                        for (var fld in ORDLINE_FLD) cols.push(ORDLINE_FLD[fld]);
                        return cols;
                    })()
                };

                var OrderLineSearch = ns_search.create(searchOption);

                if (!OrderLineSearch.runPaged().count) {
                    vclib_utils.logWarn(
                        logTitle,
                        'No OrderStatusLine : ' +
                            [poId, vendorLine.item_num, vendorLine.order_num].join(' | ')
                    );
                    return false;
                }

                var OrderLineData = {};
                OrderLineSearch.run().each(function (searchRow) {
                    OrderLineData.ID = searchRow.id;
                    for (var fld in ORDLINE_FLD)
                        OrderLineData[fld] = searchRow.getValue({ name: ORDLINE_FLD[fld] });

                    return true;
                });

                return OrderLineData;
            } catch (error) {
                vclib_error.warn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        searchOrderNums: function (option) {
            var logTitle = [LogTitle, 'searchOrderNums'].join('::'),
                returnValue,
                ORDNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDNUM_FLD = ORDNUM_REC.FIELD;

            try {
                var vendorNum = option.vendorNum || option.VendorOrderNum,
                    poId = option.poId || option.purchaseOrderId,
                    poNum = option.poNum || option.tranid;

                vclib_utils.log(logTitle, '### SEARCH ORDER NUMS ### ', option);

                if (!(poId || poNum)) {
                    vclib_utils.logWarn(logTitle, 'No PO ID or PO Number provided');
                    return;
                }

                var searchOption = {
                    type: ORDNUM_REC.ID,
                    filters: (function () {
                        var fltr = [['isinactive', 'is', 'F']];
                        if (vendorNum) fltr.push('AND', [ORDNUM_FLD.VENDOR_NUM, 'is', vendorNum]);
                        if (poId) fltr.push('AND', [ORDNUM_FLD.TXN_LINK, 'anyof', poId]);
                        if (poNum) fltr.push('AND', [ORDNUM_FLD.ORDER_NUM, 'is', poNum]);
                        return fltr;
                    })(),
                    columns: (function () {
                        var cols = ['internalid', 'name'];
                        for (var fld in ORDNUM_FLD) cols.push(ORDNUM_FLD[fld]);
                        return cols;
                    })()
                };
                vclib_utils.log(logTitle, '>> searchOption: ', searchOption);

                var OrderNumSearch = ns_search.create(searchOption);

                if (!OrderNumSearch.runPaged().count) {
                    vclib_utils.logWarn(logTitle, 'No OrderNum records found.');
                    return false;
                }

                var OrderNumData = [];
                OrderNumSearch.run().each(function (searchRow) {
                    var orderNum = { ID: searchRow.id, NAME: searchRow.getValue({ name: 'name' }) };
                    for (var fld in ORDNUM_FLD) {
                        var value = searchRow.getValue({ name: ORDNUM_FLD[fld] }),
                            textValue = searchRow.getText({ name: ORDNUM_FLD[fld] });

                        orderNum[fld] = value;
                        if (textValue && textValue != value) orderNum[fld + '_text'] = textValue;
                    }
                    OrderNumData.push(orderNum);
                    return true;
                });

                vclib_utils.log(logTitle, '-- OrderNum Data: ', OrderNumData);
                returnValue = OrderNumData;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        processOrderStatusLines: function (option) {
            var logTitle = [LogTitle, 'processOrderStatusLines'].join('::'),
                returnValue;

            try {
                if (!option.recordData) {
                    option.recordData = vcs_recordLib.searchTransaction({
                        poNum: option.poNum,
                        poId: option.poId
                    });
                }

                var orderNumRecord = LibProcess.searchOrderLines({
                    vendorNum: option.VendorOrderNum,
                    poId: option.poId,
                    poNum: option.poNum
                });
                if (orderNumRecord && orderNumRecord.ID) {
                    option.ORDERNUM_ID = orderNumRecord.ID;
                }

                orderNumRecord = Helper.addOrderNumRec(
                    util.extend(option, { orderNumRec: orderNumRecord })
                );

                var arrMatchedOrderLines = [];

                for (var i = 0, j = option.Lines.length; i < j; i++) {
                    var orderLine = option.Lines[i],
                        matchedOrderLine = {};

                    if (orderNumRecord && orderNumRecord.LINES) {
                        matchedOrderLine = vclib_utils.findMatching({
                            list: orderNumRecord.LINES,
                            filter: {
                                ITEM: orderLine.item_num,
                                ORDER_NUM: orderLine.order_num,
                                LINE_NO: orderLine.line_num
                            }
                        });

                        if (matchedOrderLine) arrMatchedOrderLines.push(matchedOrderLine);
                    }
                    vclib_utils.log(logTitle, '>> matched order line: ', matchedOrderLine);
                    orderLine.ORDERLINE_ID = matchedOrderLine.ID;
                    Helper.addOrderLineRec({
                        orderLineData: orderLine,
                        orderNumRec: orderNumRecord,
                        orderLineRec: matchedOrderLine,
                        recordData: option.recordData
                    });
                }

                vclib_utils.log(logTitle, '>> Matched Order Lines: ', [
                    arrMatchedOrderLines,
                    orderNumRecord
                ]);

                if (orderNumRecord && orderNumRecord.LINES && util.isArray(orderNumRecord.LINES)) {
                    orderNumRecord.LINES.forEach(function (orderLine) {
                        if (!vclib_utils.inArray(orderLine, arrMatchedOrderLines)) {
                            Helper.cleanupOrderLine({ orderLineId: orderLine.ID });
                        }
                    });
                }

                returnValue = orderNumRecord;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        bulkProcessOrderStatusLines: function (option) {
            var logTitle = [LogTitle, 'bulkProcessOrderStatusLines'].join('::'),
                returnValue;

            try {
                vclib_utils.log(logTitle, '#### BULK PROCESS ORDER LINES: START ####');

                if (!option.recordData) {
                    option.recordData = vcs_recordLib.searchTransaction({
                        poNum: option.poNum,
                        poId: option.poId
                    });
                }
                if (
                    !option.Orders ||
                    vclib_utils.isEmpty(option.Orders) ||
                    !util.isArray(option.Orders)
                ) {
                    vclib_utils.logWarn(logTitle, 'No Orders to process.');
                    return false;
                }

                var arrOrders = option.Orders,
                    arrOrderNums = [],
                    processedOrders = [];

                arrOrders.forEach(function (orderData) {
                    vclib_utils.dumpLog(logTitle, orderData, '[ orderData ]');

                    var orderNumRec = LibProcess.processOrderStatusLines(
                        util.extend(orderData, {
                            ConfigRec: option.ConfigRec,
                            poId: option.poId,
                            poNum: option.poNum
                        })
                    );
                    processedOrders.push(orderNumRec);
                    arrOrderNums.push(orderData.VendorOrderNum);
                });
                vclib_utils.log(logTitle, '>> Processed Orders: ', arrOrderNums);

                var arrVendorNumRecs = LibProcess.searchOrderNums({
                    poId: option.poId,
                    poNum: option.poNum
                });

                arrVendorNumRecs.forEach(function (orderNumRec) {
                    if (!vclib_utils.inArray(orderNumRec.VENDOR_NUM, arrOrderNums)) {
                        Helper.cleanupOrderNum({
                            poId: option.poId,
                            poNum: option.poNum,
                            orderNumRec: orderNumRec
                        });
                    }
                });

                returnValue = processedOrders;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        updateOrderNum: function (option) {
            var logTitle = [LogTitle, 'updateOrderNum'].join('::'),
                ORDNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDNUM_FLD = ORDNUM_REC.FIELD,
                returnValue;

            try {
                var orderNumValues = option.orderNumValues;

                var orderNumData = LibProcess.searchOrderLines({
                    vendorNum: option.vendorOrderNum || option.vendorNum || option.VendorOrderNum,
                    poId: option.poId,
                    poNum: option.poNum
                });
                if (!orderNumData) {
                    vclib_utils.logWarn(logTitle, 'No Order Num found.');
                    return false;
                }

                if (
                    !vclib_utils.isEmpty(orderNumValues.ITEM_LINK) &&
                    !vclib_utils.isEmpty(orderNumData.ITEM_LINK) &&
                    orderNumValues.ITEM_LINK == orderNumData.ITEM_LINK
                ) {
                    return;
                }

                if (orderNumValues.NOTE && orderNumValues.NOTE.length >= 300) {
                    orderNumValues.DETAILS = orderNumValues.NOTE;

                    var noteParts = orderNumValues.NOTE.split('.');
                    var newNote =
                        noteParts.length > 1
                            ? noteParts[0] + ' - (See details under Notes)'
                            : orderNumValues.NOTE;
                    if (newNote.length >= 300)
                        newNote = orderNumValues.NOTE.substring(0, 280) + '...(see more)';

                    orderNumValues.NOTE = newNote;
                }

                var submitRecOption = {
                    type: ORDNUM_REC.ID,
                    id: orderNumData.ID,
                    values: (function () {
                        var fldValues = {};
                        for (var fld in orderNumValues) {
                            fldValues[ORDNUM_FLD[fld]] = orderNumValues[fld];
                        }
                        return fldValues;
                    })()
                };

                returnValue = ns_record.submitFields(submitRecOption);
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        updateMatchedLine: function (option) {
            var logTitle = [LogTitle, 'updateMatchedLine'].join('::'),
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                returnValue;

            try {
                var vendorLine = option.vendorLine,
                    orderLine = option.orderLine;

                var orderLineData = LibProcess.searchOrderLine(option);
                if (!orderLineData) {
                    vclib_utils.logWarn(logTitle, 'No Order Line found.');
                    return false;
                }

                var submitRecOption = {
                    type: ORDLINE_REC.ID,
                    id: orderLineData.ID,
                    values: (function () {
                        var fldValues = {};
                        fldValues[ORDLINE_FLD.ITEM_LINK] =
                            orderLine && orderLine.item
                                ? orderLine.item
                                : vendorLine.ITEM_LINK
                                  ? vendorLine.ITEM_LINK
                                  : null;
                        fldValues[ORDLINE_FLD.PO_QTY] =
                            orderLine && orderLine.quantity ? orderLine.quantity : null;
                        return fldValues;
                    })()
                };

                returnValue = ns_record.submitFields(submitRecOption);
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },

        cleanupOrderStatusLines: function (option) {
            var logTitle = [LogTitle, 'cleanupOrderStatusLines'].join('::'),
                returnValue;

            var ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                ORDERNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDERNUM_FLD = ORDERNUM_REC.FIELD;
            try {
                var poId = option.poId,
                    poNum = option.poNum;

                if (!poId && !poNum) {
                    vclib_utils.logWarn(logTitle, 'No PO ID or PO Number provided');
                    return false;
                }

                var allOrderNumIds = [],
                    orderNumsToDelete = [];

                var orderNumFilters = [];
                if (poId) orderNumFilters.push([ORDERNUM_FLD.TXN_LINK, 'anyof', poId]);
                else if (poNum) orderNumFilters.push([ORDERNUM_FLD.ORDER_NUM, 'is', poNum]);

                var orderNumResults = vcs_recordLib.searchRecord({
                    type: ORDERNUM_REC.ID,
                    filters: orderNumFilters,
                    columns: ['internalid', ORDERNUM_FLD.ORDER_NUM, ORDERNUM_FLD.ITEMFF_LINK],
                    returnSingleRecord: false
                });

                if (orderNumResults && util.isArray(orderNumResults)) {
                    orderNumResults.forEach(function (row) {
                        allOrderNumIds.push(row.id);
                        if (!row[ORDERNUM_FLD.ITEMFF_LINK]) orderNumsToDelete.push(row.id);
                    });
                }

                vclib_utils.log(logTitle, '>> All OrderNums: ', allOrderNumIds);
                vclib_utils.log(
                    logTitle,
                    '>> OrderNums to inactivate (no fulfillment): ',
                    orderNumsToDelete
                );

                // collect all order lines for ALL order nums
                var orderLineList = [];
                if (allOrderNumIds.length) {
                    var orderLineResults = vcs_recordLib.searchRecord({
                        type: ORDLINE_REC.ID,
                        filters: [[ORDLINE_FLD.ORDNUM_LINK, 'anyof', allOrderNumIds]],
                        columns: ['internalid', ORDLINE_FLD.ITEM, ORDLINE_FLD.ORDNUM_LINK],
                        returnSingleRecord: false
                    });

                    if (orderLineResults && util.isArray(orderLineResults)) {
                        orderLineResults.forEach(function (row) {
                            orderLineList.push(row.id);
                        });
                    }
                }
                vclib_utils.log(logTitle, '>> OrderLines to cleanup: ', orderLineList);

                // inactivate all order lines
                orderLineList.forEach(function (orderLineId) {
                    var lineValues = { isinactive: true };
                    lineValues[ORDLINE_FLD.LINE_STATUS] = 'DELETED';
                    ns_record.submitFields({
                        type: ORDLINE_REC.ID,
                        id: orderLineId,
                        values: lineValues
                    });
                });

                // inactivate order nums without fulfillment
                orderNumsToDelete.forEach(function (orderNumId) {
                    var numValues = { isinactive: true };
                    numValues[ORDERNUM_FLD.ORDER_STATUS] = 'DELETED';
                    ns_record.submitFields({
                        type: ORDERNUM_REC.ID,
                        id: orderNumId,
                        values: numValues
                    });
                });

                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },

        searchInactiveOrderNums: function (option) {
            var logTitle = [LogTitle, 'searchInactiveOrderNums'].join('::'),
                returnValue = [];

            var ORDERNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDERNUM_FLD = ORDERNUM_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum;

                var orderNumFilters = [['isinactive', 'is', 'T']];
                if (poId) orderNumFilters.push('AND', [ORDERNUM_FLD.TXN_LINK, 'anyof', poId]);
                else if (poNum) orderNumFilters.push('AND', [ORDERNUM_FLD.ORDER_NUM, 'is', poNum]);

                var orderNumResults = vcs_recordLib.searchRecord({
                    type: ORDERNUM_REC.ID,
                    filters: orderNumFilters,
                    columns: ['internalid'],
                    returnSingleRecord: false
                });

                if (orderNumResults && util.isArray(orderNumResults)) {
                    orderNumResults.forEach(function (row) {
                        returnValue.push(row.id);
                    });
                }

                vclib_utils.log(logTitle, '>> Inactive OrderNums found: ', returnValue.length);
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = [];
            }

            return returnValue;
        },

        searchInactiveOrderLines: function (option) {
            var logTitle = [LogTitle, 'searchInactiveOrderLines'].join('::'),
                returnValue = [];

            var ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD;

            try {
                var orderNumIds = option.orderNumIds;
                if (!orderNumIds || !orderNumIds.length) return returnValue;

                var orderLineResults = vcs_recordLib.searchRecord({
                    type: ORDLINE_REC.ID,
                    filters: [
                        ['isinactive', 'is', 'T'],
                        'AND',
                        [ORDLINE_FLD.ORDNUM_LINK, 'anyof', orderNumIds]
                    ],
                    columns: ['internalid'],
                    returnSingleRecord: false
                });

                if (orderLineResults && util.isArray(orderLineResults)) {
                    orderLineResults.forEach(function (row) {
                        returnValue.push(row.id);
                    });
                }

                vclib_utils.log(logTitle, '>> Inactive OrderLines found: ', returnValue.length);
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = [];
            }

            return returnValue;
        },

        bulkDeleteOrderStatusLines: function (option) {
            var logTitle = [LogTitle, 'bulkDeleteOrderStatusLines'].join('::'),
                returnValue;

            var ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                ORDERNUM_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDERNUM_FLD = ORDERNUM_REC.FIELD;

            try {
                var poId = option.poId,
                    poNum = option.poNum;

                if (!poId && !poNum) {
                    vclib_utils.logWarn(logTitle, 'No PO ID or PO Number provided');
                    return false;
                }

                var listOrderNums = [],
                    listOrderLines = [];

                var searchOption = {
                    type: ORDLINE_REC.ID,
                    filters: (function () {
                        var poFilter = [];

                        if (poId || poNum) {
                            if (poId) {
                                if (poFilter.length) poFilter.push('OR');
                                poFilter.push([
                                    [ORDLINE_FLD.ORDNUM_LINK, ORDERNUM_FLD.TXN_LINK].join('.'),
                                    'anyof',
                                    poId
                                ]);
                            }
                            if (poNum) {
                                if (poFilter.length) poFilter.push('OR');
                                poFilter.push([
                                    [ORDLINE_FLD.ORDNUM_LINK, ORDERNUM_FLD.ORDER_NUM].join('.'),
                                    'is',
                                    poNum
                                ]);
                            }

                            return poFilter;
                        }
                    })(),
                    columns: [
                        'internalid',
                        ORDLINE_FLD.ITEM,
                        ORDLINE_FLD.ORDNUM_LINK,
                        [ORDLINE_FLD.ORDNUM_LINK, 'internalid'].join('.'),
                        [ORDLINE_FLD.ORDNUM_LINK, 'name'].join('.')
                    ]
                };

                ns_search
                    .create(searchOption)
                    .run()
                    .each(function (searchRow) {
                        var orderLineId = searchRow.id,
                            orderNumId = searchRow.getValue({
                                name: 'internalid',
                                join: ORDLINE_FLD.ORDNUM_LINK
                            });

                        if (!vclib_utils.inArray(orderNumId, listOrderNums))
                            listOrderNums.push(orderNumId);

                        if (!vclib_utils.inArray(orderLineId, listOrderLines))
                            listOrderLines.push(orderLineId);

                        return true;
                    });

                ns_search
                    .create({
                        type: ORDERNUM_REC.ID,
                        filters: (function () {
                            var fltr = [];
                            if (poId) fltr.push([ORDERNUM_FLD.TXN_LINK, 'anyof', poId]);
                            if (poNum) fltr.push([ORDERNUM_FLD.ORDER_NUM, 'is', poNum]);
                            return fltr;
                        })(),
                        columns: ['internalid']
                    })
                    .run()
                    .each(function (searchRow) {
                        var orderNumId = searchRow.id;
                        if (!vclib_utils.inArray(orderNumId, listOrderNums))
                            listOrderNums.push(orderNumId);
                        return true;
                    });

                listOrderLines.forEach(function (orderLineId) {
                    var lineValues = { isinactive: true };
                    lineValues[ORDLINE_FLD.LINE_STATUS] = 'DELETED';
                    ns_record.submitFields({
                        type: ORDLINE_REC.ID,
                        id: orderLineId,
                        values: lineValues
                    });
                });
                listOrderNums.forEach(function (orderNumId) {
                    var numValues = { isinactive: true };
                    numValues[ORDERNUM_FLD.ORDER_STATUS] = 'DELETED';
                    ns_record.submitFields({
                        type: ORDERNUM_REC.ID,
                        id: orderNumId,
                        values: numValues
                    });
                });

                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        }
    });

    var LibOrderDetails = {
        searchOrderDetails: function (option) {
            var logTitle = [LogTitle, 'searchOrderDetails'].join('::'),
                ORDDETAIL_REC = vclib_constants.RECORD.ORDER_NUM,
                ORDDETAIL_FLD = ORDDETAIL_REC.FIELD,
                returnValue;

            try {
                var searchOption = {
                    type: ORDDETAIL_REC.ID,
                    filters: [],
                    columns: (function () {
                        var cols = ['internalid'];
                        for (var fld in ORDDETAIL_FLD) cols.push(ORDDETAIL_FLD[fld]);
                        return cols;
                    })()
                };

                for (var fld in ORDDETAIL_FLD) {
                    if (option[fld] == null || option[fld] == 'NA') continue;
                    searchOption.filters.push([ORDDETAIL_FLD[fld], 'is', option[fld]]);
                }

                var searchObj = ns_search.create(searchOption),
                    searchResults = vclib_utils.searchAllPaged({ searchObj: searchObj });

                if (vclib_utils.isEmpty(searchResults)) return false;

                returnValue = [];
                searchResults.forEach(function (searchRow) {
                    var rowData = { id: searchRow.id };
                    for (var fld in ORDDETAIL_FLD) {
                        var value = searchRow.getValue({ name: ORDDETAIL_FLD[fld] }),
                            textValue = searchRow.getText({ name: ORDDETAIL_FLD[fld] });

                        rowData[fld] = value;
                        if (textValue && value !== textValue) rowData[fld + '_text'] = textValue;
                    }
                    returnValue.push(rowData);
                    return true;
                });
            } catch (error) {
                vclib_error.warn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        searchOrderDetailLines: function (option) {
            var logTitle = [LogTitle, 'searchOrderDetailLines'].join('::'),
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                returnValue;

            try {
                var searchOption = {
                    type: ORDLINE_REC.ID,
                    filters: [['isinactive', 'is', 'F']],
                    columns: (function () {
                        var cols = ['internalid'];
                        for (var fld in ORDLINE_FLD) cols.push(ORDLINE_FLD[fld]);
                        return cols;
                    })()
                };

                for (var fld in ORDLINE_FLD) {
                    if (option[fld] == null || option[fld] == 'NA') continue;
                    var oper = 'is';
                    if (
                        vclib_utils.inArray(fld, [
                            'ORDNUM_LINK',
                            'ITEM_LINK',
                            'TXN_LINK',
                            'ITEMFF_LINK'
                        ])
                    ) {
                        oper = 'anyof';
                    }
                    searchOption.filters.push('AND', [ORDLINE_FLD[fld], oper, option[fld]]);
                }

                var searchObj = ns_search.create(searchOption),
                    searchResults = vclib_utils.searchAllPaged({ searchObj: searchObj });

                if (vclib_utils.isEmpty(searchResults)) return false;
                returnValue = [];
                searchResults.forEach(function (searchRow) {
                    var rowData = { id: searchRow.id };

                    for (var fld in ORDLINE_FLD) {
                        var value = searchRow.getValue({ name: ORDLINE_FLD[fld] }),
                            textValue = searchRow.getText({ name: ORDLINE_FLD[fld] });

                        rowData[fld] = value;
                        if (textValue && value !== textValue) rowData[fld + '_text'] = textValue;
                    }

                    returnValue.push(rowData);
                    return true;
                });
            } catch (error) {
                vclib_error.warn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        updateOrderDetail: function (option) {
            var logTitle = [LogTitle, 'updateOrderDetail'].join('::'),
                ORDDETAIL_REC = vclib_constants.RECORD.ORDER_DETAIL,
                ORDDETAIL_FLD = ORDDETAIL_REC.FIELD,
                returnValue;

            try {
                var orderDetailId = option.id || option.orderDetailId,
                    orderDetailValues = option.values || option.orderDetailValues;
                if (!orderDetailId) throw 'Missing Order Detail ID';
                if (vclib_utils.isEmpty(orderDetailValues)) throw 'Missing Order Detail Values';

                var submitRecOption = {
                    type: ORDDETAIL_REC.ID,
                    id: orderDetailId,
                    values: {},
                    ignoreMandatoryFields: true
                };

                for (var fld in ORDDETAIL_FLD) {
                    if (orderDetailValues[fld] === undefined) continue;
                    submitRecOption.values[ORDDETAIL_FLD[fld]] = orderDetailValues[fld];
                }

                returnValue = ns_record.submitFields(submitRecOption);
            } catch (error) {
                vclib_error.warn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },
        updateOrderDetailLine: function (option) {
            var logTitle = [LogTitle, 'updateOrderDetailLine'].join('::'),
                ORDLINE_REC = vclib_constants.RECORD.ORDER_LINE,
                ORDLINE_FLD = ORDLINE_REC.FIELD,
                returnValue;
            try {
                var orderLineId = option.id || option.orderLineId,
                    orderLineValues = option.values || option.orderLineValues;
                if (!orderLineId) throw 'Missing Orderline ID';
                if (vclib_utils.isEmpty(orderLineValues)) throw 'Missing Orderline Values';

                var submitRecOption = {
                    type: ORDLINE_REC.ID,
                    id: orderLineId,
                    values: {},
                    ignoreMandatoryFields: true
                };

                for (var fld in ORDLINE_FLD) {
                    if (orderLineValues[fld] === undefined) continue;
                    submitRecOption.values[ORDLINE_FLD[fld]] = orderLineValues[fld];
                }

                returnValue = ns_record.submitFields(submitRecOption);
            } catch (error) {
                vclib_error.warn(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * @function bulkUpdateOrderDetailLines
         * @description Batch-updates ORDER_LINE custom records from matched vendor lines.
         *   Expects vendorLines to have MATCHING populated (from txnLib.updatePurchaseOrder).
         * @param {Object} option
         * @param {string} option.poId - Purchase Order internal ID
         * @param {Array} option.vendorLines - Vendor lines with MATCHING from item matching
         * @returns {Array} Array of update results
         */
        bulkUpdateOrderDetailLines: function (option) {
            var logTitle = [LogTitle, 'bulkUpdateOrderDetailLines'].join('::'),
                returnValue = [];

            try {
                var poId = option.poId,
                    vendorLines = option.vendorLines || [];

                if (!poId) throw 'Missing poId';

                vendorLines.forEach(function (vendorLine) {
                    var orderLine = vendorLine.MATCHING
                        ? vendorLine.MATCHING[0] || vendorLine.MATCHING
                        : null;

                    if (!orderLine) return;

                    var orderLineResults = LibOrderDetails.searchOrderDetailLines({
                        TXN_LINK: poId,
                        ITEM: vendorLine.item_num,
                        ORDER_NUM: vendorLine.order_num,
                        LINE_NO: vendorLine.line_num,
                        LINE_STATUS: vendorLine.line_status,
                        QTY: vendorLine.ship_qty
                    });

                    if (vclib_utils.isEmpty(orderLineResults)) return;

                    (orderLineResults || []).forEach(function (orderLineResult) {
                        var orderLineValue = {};
                        if (!orderLineResult.ITEM_LINK && vendorLine.ITEM_LINK) {
                            orderLineValue.ITEM_LINK = vendorLine.ITEM_LINK;
                        }

                        orderLineValue.PO_RATE = orderLine.APPLIEDRATE;
                        orderLineValue.VND_RATE = vendorLine.APPLIEDRATE;
                        orderLineValue.PO_QTY = orderLine.quantity - orderLine.quantityreceived;
                        orderLineValue.POLINE_UNIQKEY = orderLine.lineuniquekey;

                        var result = LibOrderDetails.updateOrderDetailLine({
                            id: orderLineResult.id,
                            values: orderLineValue
                        });
                        returnValue.push(result);
                    });
                });
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        },

        /**
         * @function bulkProcessSerials
         * @description Batch serial processing for all orders. Self-loads config to check serial flags,
         *   then prepares and processes serials for each order's lines.
         * @param {Object} option
         * @param {string} option.poId - Purchase Order internal ID
         * @param {string} [option.soId] - Sales Order internal ID
         * @param {string} [option.customerId] - Customer internal ID
         * @param {Array} option.orders - Array of order objects with VendorOrderNum, Lines
         * @param {Array} option.lines - All vendor lines
         * @param {Object} [option.fulfillmentResponse] - Map of VendorOrderNum to { id }
         * @param {boolean} [option.isDropPO] - Whether the PO is a drop ship
         * @returns {boolean}
         */
        bulkProcessSerials: function (option) {
            var logTitle = [LogTitle, 'bulkProcessSerials'].join('::'),
                returnValue = false;

            try {
                var poId = option.poId,
                    soId = option.soId,
                    customerId = option.customerId,
                    orders = option.orders || [],
                    lines = option.lines || [],
                    fulfillmentResponse = option.fulfillmentResponse || {},
                    isDropPO = option.isDropPO;

                if (!poId) throw 'Missing poId';

                var MainCFG = vcs_configLib.mainConfig();
                if (!MainCFG) throw 'Could not load Main Config';

                if (isDropPO && !MainCFG.createSerialDropship) {
                    vclib_utils.log(logTitle, 'Serial processing for Dropship is not enabled');
                    return returnValue;
                }
                if (!isDropPO && !MainCFG.createSerialSpecialOrder) {
                    vclib_utils.log(logTitle, 'Serial processing for Special Order is not enabled');
                    return returnValue;
                }

                orders.forEach(function (orderData) {
                    var orderNum = orderData.VendorOrderNum;
                    var orderLines = lines.filter(function (line) {
                        return line.order_num == orderNum;
                    });
                    var fulfillmentId =
                        fulfillmentResponse[orderNum] && fulfillmentResponse[orderNum].id;

                    var serialData = {
                        poId: poId,
                        soId: soId,
                        customerId: customerId,
                        itemff: fulfillmentId
                    };

                    var arrSerials = LibProcess.prepareSerialsFromOrderLines(
                        vclib_utils.extend(serialData, { orderLines: orderLines })
                    );

                    if (!vclib_utils.isEmpty(arrSerials) && util.isArray(arrSerials)) {
                        arrSerials.forEach(function (serialOption) {
                            LibProcess.processSerials(serialOption);
                        });
                    }
                });

                returnValue = true;
            } catch (error) {
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        }
    };

    util.extend(LibProcess, LibOrderDetails);

    return LibProcess;
});
/**
 * USAGE:
 * 
{
  "moduleName": "processV1",
  "action": "OrderStatusDebug",
  "parameters": {
    "poNum": "124640",
    "vendorConfigId": "505",
    "showLines": true
  }
}
 */
