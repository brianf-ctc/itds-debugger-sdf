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
 * Script Name: VC Services | Webservice Orchestration Library
 * @author brianf@nscatalyst.com
 * @description Orchestrates vendor webservice calls and normalizes responses for VAR Connect 2.x.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-25   brianf        Added zero unit price validation with autofulfillZeroAmtLines config check; load MainCFG in OrderStatus flows
 * 2026-03-08   brianf        Hardened shipped/error handling; fixed vendor map typo; added option guards and explicit WebserviceLib return
 * 2026-03-04   brianf        Improve delivery date validation logic with ETA fallback
 * 2025-01-15   brianf        Initial build.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    const LogTitle = 'SVC:WebSVC1',
        LOG_APP = 'WebSVC';

    var ns_record = require('N/record');

    var vc2_util = require('../CTC_VC2_Lib_Utils.js'),
        vc2_constant = require('../CTC_VC2_Constants.js'),
        vcs_recordsLib = require('./ctc_svclib_records.js'),
        vcs_configLib = require('./ctc_svclib_configlib.js');

    var vclib_error = require('./lib/ctc_lib_error.js');

    // vendor libraries
    var lib_arrow = require('./vendor/ctc_vclib_arrow.js'),
        lib_carahsoft = require('./vendor/ctc_vclib_carahsoft.js'),
        lib_cisco = require('./vendor/ctc_vclib_cisco.js'),
        lib_dell = require('./vendor/ctc_vclib_dell.js'),
        lib_dnh = require('./vendor/ctc_vclib_dandh.js'),
        lib_ingram = require('./vendor/ctc_vclib_ingram.js'),
        lib_jenne = require('./vendor/ctc_vclib_jenne.js'),
        lib_scansource = require('./vendor/ctc_vclib_scansource.js'),
        lib_synnex = require('./vendor/ctc_vclib_synnex.js'),
        lib_techdata = require('./vendor/ctc_vclib_techdata.js'),
        lib_wefi = require('./vendor/ctc_vclib_wefi.js');

    var moment = require('./lib/moment.js');

    var CACHE_TTL = 300; // store the data for 1mins
    var VendorList = vc2_constant.LIST.XML_VENDOR,
        VendorCFG = null,
        MainCFG = null,
        ERROR_MSG = vc2_constant.ERRORMSG;

    var ERROR_LIST = {
        NO_SHIPPED_QTY: {
            code: 'NO_SHIPPED_QTY',
            message: 'No shipped quantity',
            level: vclib_error.ErrorLevel.WARNING
        },
        NO_DELIVERY_DATE: {
            code: 'NO_DELIVERY_DATE',
            message: 'No delivery date',
            level: vclib_error.ErrorLevel.WARNING
        },
        NO_SHIPPED_DATE: {
            code: 'NO_SHIPPED_DATE',
            message: 'No shipped date',
            level: vclib_error.ErrorLevel.WARNING
        },
        INVALID_DATE_FORMAT: {
            code: 'INVALID_DATE_FORMAT',
            message: 'Invalid date format',
            level: vclib_error.ErrorLevel.WARNING
        },
        NOT_YET_DELIVDATE: {
            code: 'NOT_YET_DELIVDATE',
            message: '(Fulfill on Delivery) Not yet delivery date ',
            level: vclib_error.ErrorLevel.WARNING
        },
        NOT_YET_SHIPPEDDATE: {
            code: 'NOT_YET_SHIPPEDDATE',
            message: '(Fulfill on Delivery) Not yet delivery date ',
            level: vclib_error.ErrorLevel.WARNING
        }
    };

    var Helper = {
        getVendorLibrary: function (OrderCFG) {
            // VENDOR MAPPED  //
            var MAPPED_VENDORLIB = {
                TECH_DATA: lib_techdata,

                SYNNEX: lib_synnex,
                SYNNEX_API: lib_synnex,

                DandH: lib_dnh,

                INGRAM_MICRO: lib_ingram,
                INGRAM_MICRO_API: lib_ingram,
                INGRAM_MICRO_V_ONE: lib_ingram,

                CISCO: lib_cisco,

                DELL: lib_dell,

                AVNET: lib_arrow,
                WESTCON: lib_arrow,
                ARROW: lib_arrow,

                JENNE: lib_jenne,
                SCANSOURCE: lib_scansource,
                WEFI: lib_wefi,
                CARAHSOFT: lib_carahsoft
            };
            // get the vendor name from XML_VENDOR
            var vendorName;
            for (var name in VendorList) {
                if (VendorList[name] != OrderCFG.xmlVendor) continue;
                vendorName = name;
            }
            if (!vendorName) throw 'Missing vendor configuration';
            // Fixed: Correct variable reference to avoid ReferenceError when vendor mapping is missing.
            if (!MAPPED_VENDORLIB[vendorName]) throw 'Missing vendor library for ' + vendorName;

            return MAPPED_VENDORLIB[vendorName];
        },
        validateShipped: function (lineData) {
            var logTitle = [LogTitle, 'Helper.isShipped'].join('::');

            var isShipped = false,
                shippedReason = [];
            var lineShipped = { is_shipped: true };

            var FULFILL_DATE = vc2_constant.LIST.FULFILL_DATE;

            try {
                // vc2_util.log(logTitle, '// line data: ', lineData);
                // if no ship_qty, then its not shipped, ship_qty = 0
                //

                if (lineData.hasOwnProperty('valid_shipped_status')) {
                    if (!lineData.valid_shipped_status) throw 'Status: Not Shipped';
                    else shippedReason.push('Shipped Status');
                }

                if (vc2_util.isEmpty(lineData.ship_qty) || lineData.ship_qty == 0)
                    throw 'NO_SHIPPED_QTY';
                else shippedReason.push('has_shippedqty');

                if (lineData.hasOwnProperty('is_invoiced') && lineData.is_invoiced) {
                    shippedReason.push('is_invoiced');
                    return true;
                }

                var todayDate = new Date(); //moment().toDate();

                if (VendorCFG && VendorCFG.useFulfillDate) {
                    // check for Delivery date/Delivery ETA
                    var delivDate =
                            Helper.getValidValue(lineData.deliv_date) ||
                            Helper.getValidValue(lineData.deliv_eta) ||
                            null,
                        shippedDate = Helper.getValidValue(lineData.ship_date) || null;

                    // check if there's a delivery date
                    if (VendorCFG.useFulfillDate == FULFILL_DATE.DELIV_DATE) {
                        if (vc2_util.isEmpty(delivDate)) throw 'NO_DELIVERY_DATE';

                        delivDate = delivDate ? moment(delivDate).toDate() : null;

                        if (!util.isDate(delivDate)) throw 'NO_DELIVERY_DATE';
                        else shippedReason.push('has_delivdate');

                        if (delivDate > todayDate) throw 'NOT_YET_DELIVDATE';
                        else shippedReason.push('delivdate_past');
                    } else if (!vc2_util.isEmpty(shippedDate)) {
                        // ...otherwise, just go with shipped date
                        shippedDate = shippedDate ? moment(shippedDate).toDate() : null;

                        if (!util.isDate(shippedDate)) throw 'INVALID_DATE_FORMAT';

                        if (shippedDate > todayDate) throw 'NOT_YET_SHIPPEDDATE';
                        else shippedReason.push('shippeddate_past');
                    } else throw 'NO_SHIPPED_DATE';
                }

                if (lineData.hasOwnProperty('unitprice')) {
                    if (!vc2_util.isEmpty(lineData.unitprice) && lineData.unitprice > 0) {
                        shippedReason.push('has_unitprice');
                    } else if (
                        !vc2_util.isEmpty(lineData.unitprice) &&
                        parseFloat(lineData.unitprice) === 0
                    ) {
                        if (MainCFG && MainCFG.autofulfillZeroAmtLines) {
                            shippedReason.push('zero_unitprice_allowed');
                        } else {
                            lineShipped.SKIPPED = true;
                            throw 'Zero unit price';
                        }
                    }
                }
                // check for is_shipped flag, based on status
                if (lineData.is_shipped) {
                    shippedReason.push('shipped_status');
                    return true; // its already shipped, based on status
                }
                isShipped = true; // if it passes all the checks, then its shipped
            } catch (error) {
                // vc2_util.logError(logTitle, 'NOT SHIPPED: ' + error);
                var errObj = vclib_error.interpret(error, ERROR_LIST);
                errObj.detail = lineData;

                vclib_error.warn(logTitle, errObj);

                isShipped = false;
                lineShipped.is_shipped = false;
                lineShipped.NOTSHIPPED = errObj.message;
            } finally {
                lineShipped.SHIPPED = shippedReason.join('|');
                util.extend(lineData, lineShipped);
            }

            return isShipped;
        },
        evaluateError: function (errorObj) {
            var logTitle = [LogTitle, 'Helper.evaluateError'].join('::'),
                returnError = {
                    code: null,
                    hasError: true,
                    message: null,
                    details: null
                };

            var errorCodeList = {
                INVALID_CREDENTIALS: [
                    new RegExp(/Application with identifier .+? was not found in the directory/gi),
                    new RegExp(/The realm .+? is not a configured realm of the tenant/gi),
                    new RegExp(/Invalid client secret provided/gi),
                    new RegExp(/Invalid client identifier/gi),
                    new RegExp(/Invalid client or Invalid client credentials/gi),
                    new RegExp(/The resource principal named .+? was not found in the tenant/gi),
                    new RegExp(/Access denied due to invalid subscription key/gi),
                    new RegExp(/The login was invalid/gi),
                    new RegExp(/.+?: customer validation failed/gi),
                    new RegExp(/Login failed/gi),
                    new RegExp(/The customer# .+? you provided does not exist in our system/gi),
                    new RegExp(/X-Account is not a valid account/gi),
                    new RegExp(/X-Account header not found or unable to parse as guid/gi),
                    new RegExp(/The given client credentials were not valid/gi),
                    new RegExp(/Username or password not valid/gi),
                    new RegExp(
                        /The customer number provided on the API call does not match the registered customer number/gi
                    )
                ],
                ORDER_NOT_FOUND: [
                    new RegExp(/Order not found/gi),
                    new RegExp(/Record Not Found/gi),
                    new RegExp(/No Orders found for submitted values/gi),
                    new RegExp(/<Code>notFound<\/Code>/gi),
                    new RegExp(/No data meeting the selection criteria was found/gi),
                    new RegExp(/Not Found/gi)
                ],
                INVALID_ACCESSPOINT: [
                    new RegExp(/Tenant .+? not found/gi),
                    new RegExp(/Received invalid response code/gi),
                    new RegExp(/ERROR: No Handler Defined for request type/gi)
                ],
                ENDPOINT_URL_ERROR: [
                    new RegExp(/Resource not found/gi),
                    new RegExp(/The host you requested .+? is unknown or cannot be found/gi),
                    new RegExp(/Received invalid response code/gi)
                ],
                INVALID_ACCESS_TOKEN: [new RegExp(/Invalid or missing authorization token/gi)]
            };
            // vc2_util.logError(logTitle, errorObj);

            var matchedErrorCode = null,
                message = vc2_util.extractError(errorObj),
                // Fixed: Ensure detail always resolves to a string before regex matching.
                detail = util.isString(errorObj)
                    ? errorObj
                    : (errorObj && (errorObj.message || errorObj.detail || errorObj.details)) || '';

            for (var errorCode in errorCodeList) {
                for (var i = 0, j = errorCodeList[errorCode].length; i < j; i++) {
                    var regStr = errorCodeList[errorCode][i];
                    if ((message || '').match(regStr) || (detail || '').match(regStr)) {
                        matchedErrorCode = errorCode;
                        break;
                    }
                }
                if (matchedErrorCode) break;
            }

            util.extend(
                returnError,
                util.extend(
                    util.extend(returnError, {
                        code: matchedErrorCode,
                        details: detail || message
                    }),
                    matchedErrorCode && ERROR_MSG[matchedErrorCode]
                        ? ERROR_MSG[matchedErrorCode]
                        : { message: util.isString(errorObj) ? errorObj : 'Unexpected Error' }
                )
            );

            // vc2_util.log(logTitle, '// return error: ', returnError);

            return returnError;
        },
        collectOrderLines: function (option) {
            var logTitle = [LogTitle, 'collectOrderLines'].join('::');

            var ordersList = option.Orders || [],
                linesList = option.Lines || [];

            // vc2_util.log(logTitle, '// total Orders/Lines: ', [
            //     ordersList.length,
            //     linesList.length
            // ]);
            ordersList.forEach(function (orderInfo) {
                var arrList = vc2_util.findMatching({
                    list: linesList,
                    findAll: true,
                    filter: {
                        order_num: orderInfo.VendorOrderNum
                    }
                });

                // check for the shipped status
                util.extend(orderInfo, {
                    isShipped: [],
                    ShippedDate: [],
                    Reason: [],
                    ETA: [],
                    ETD: [],
                    DelivDate: []
                });
                (arrList || []).forEach(function (lineData) {
                    if (
                        lineData.is_shipped &&
                        !vc2_util.inArray(lineData.is_shipped, orderInfo.isShipped)
                    ) {
                        orderInfo.isShipped.push(lineData.is_shipped);
                    }
                    if (
                        lineData.ship_date &&
                        lineData.ship_date !== 'NA' &&
                        !vc2_util.inArray(lineData.ship_date, orderInfo.ShippedDate)
                    ) {
                        orderInfo.ShippedDate.push(lineData.ship_date);
                    }
                    if (
                        lineData.order_eta &&
                        lineData.order_eta !== 'NA' &&
                        !vc2_util.inArray(lineData.order_eta, orderInfo.ETA)
                    ) {
                        orderInfo.ETA.push(lineData.order_eta);
                    }
                    if (
                        lineData.deliv_eta &&
                        lineData.deliv_eta !== 'NA' &&
                        !vc2_util.inArray(lineData.deliv_eta, orderInfo.ETD)
                    ) {
                        orderInfo.ETD.push(lineData.deliv_eta);
                    }
                    if (
                        lineData.deliv_date &&
                        lineData.deliv_date !== 'NA' &&
                        !vc2_util.inArray(lineData.deliv_date, orderInfo.DelivDate)
                    ) {
                        orderInfo.DelivDate.push(lineData.deliv_date);
                    }

                    if (
                        lineData.NOTSHIPPED &&
                        !vc2_util.inArray(lineData.NOTSHIPPED, orderInfo.Reason)
                    ) {
                        orderInfo.Reason.push(lineData.NOTSHIPPED);
                    }
                });

                ['isShipped', 'ShippedDate', 'ETA', 'ETD', 'DelivDate', 'Reason'].forEach(
                    function (key) {
                        if (vc2_util.isEmpty(orderInfo[key])) orderInfo[key] = null;
                        else if (orderInfo[key].length) orderInfo[key] = orderInfo[key][0];
                        return;
                    }
                );

                // vc2_util.log(logTitle, '// arrList: ', arrList);
                orderInfo.Lines = arrList || [];
            });
        },
        getValidValue: function (value) {
            return !vc2_util.isEmpty(value) && value !== 'NA' ? value : null;
        },
        flattenResults: function (option) {
            var logTitle = [LogTitle, 'Helper.flattenResults'].join('::');

            if (!option || !option.Orders || !option.Lines) {
                vc2_util.log(logTitle, '>> No data to flatten');
                return option;
            }

            vc2_util.log(logTitle, '>> Flattening results...', option.Lines.length);

            var uniqDataLines = {};
            option.Lines.forEach(function (lineData) {
                var uniqValues = vc2_util.arrayValues(
                        vc2_util.extractValues({
                            source: lineData,
                            fields: [
                                'order_num',
                                'order_status',
                                'line_num',
                                'line_status',
                                'item_num',
                                'vendorSKU'
                            ]
                        })
                    ),
                    uniqKey = uniqValues.join('||'),
                    uniqDataLine = uniqDataLines[uniqKey];

                if (!uniqDataLine) {
                    uniqDataLines[uniqKey] = lineData;
                } else {
                    for (var field in lineData) {
                        // skip if field does not exist in uniqDataLine
                        if (!uniqDataLine.hasOwnProperty(field)) {
                            uniqDataLine[field] = lineData[field];
                            continue;
                        }

                        if (field == 'ship_qty') {
                            uniqDataLine[field] =
                                parseFloat(uniqDataLine[field]) + parseFloat(lineData[field]);
                        } else {
                            if (util.isArray(uniqDataLine[field])) {
                                if (!vc2_util.inArray(lineData[field], uniqDataLine[field])) {
                                    uniqDataLine[field].push(lineData[field]);
                                }
                            } else if (uniqDataLine[field] != lineData[field]) {
                                uniqDataLine[field] = [uniqDataLine[field], lineData[field]];
                            }
                        }
                    }
                }
            });

            // copy the unique lines to OrderDataLines
            var OrderDataLines = [];
            for (var uniqKey in uniqDataLines) {
                for (var field in uniqDataLines[uniqKey]) {
                    if (util.isArray(uniqDataLines[uniqKey][field]))
                        uniqDataLines[uniqKey][field] = uniqDataLines[uniqKey][field].join(',');
                }

                OrderDataLines.push(uniqDataLines[uniqKey]);
            }

            vc2_util.log(logTitle, '>> Flattened lines: ', OrderDataLines.length);

            option.Lines = OrderDataLines;

            return option;
        }
    };

    var WebserviceLib = {
        OrderStatusDebug: function (option) {
            var logTitle = [LogTitle, 'OrderStatusDebug'].join(':'),
                returnValue = {};

            // Fixed: Guard option access to prevent runtime errors when called without arguments.
            option = option || {};

            vc2_util.log(logTitle, '###### WEBSERVICE: OrderStatus Debug: ######', option);

            try {
                var poNum = option.poNum || option.tranid,
                    vendorConfig = option.vendorConfig || option.orderConfig,
                    vendoCfgId = option.vendorConfigId;

                // load the main config
                MainCFG = vcs_configLib.mainConfig();

                // load the configuration
                VendorCFG =
                    vendorConfig ||
                    vcs_configLib.loadConfig({
                        poNum: poNum,
                        configId: vendoCfgId,
                        configType: vcs_configLib.ConfigType.ORDER,
                        debugMode: true
                    });
                // vc2_util.log(logTitle, '>> ConfigRec: ', ConfigRec);

                // get the Vendor Library
                var vendorLib = Helper.getVendorLibrary(VendorCFG);

                var response = vendorLib.process({
                    poNum: poNum,
                    orderConfig: VendorCFG,
                    debugMode: true,
                    showLines: !!option.showLines
                });

                if (option.showLines && !vc2_util.isEmpty(response.Lines)) {
                    response.Lines.forEach(function (lineData) {
                        Helper.validateShipped(lineData, VendorCFG);
                    });
                }

                returnValue = response;
            } catch (error) {
                var errorObj = vclib_error.log(logTitle, error, ERROR_LIST);

                util.extend(
                    util.extend(returnValue, { hasError: true }),
                    Helper.evaluateError(error) || {}
                );
            } finally {
                vc2_util.log(logTitle, '##### WEBSERVICE | Return: #####');
            }

            return returnValue;
        },
        OrderStatus: function (option) {
            var logTitle = [LogTitle, 'orderStatus'].join(':'),
                returnValue = {
                    Orders: null,
                    Lines: null,
                    ConfigRec: null,
                    Source: null
                };

            // Fixed: Guard option access to prevent runtime errors when called without arguments.
            option = option || {};

            vc2_util.log(logTitle, '###### WEBSERVICE: OrderStatus: ######', option);

            try {
                var poNum = option.poNum || option.tranid,
                    poId = option.poId,
                    vendoCfgId = option.vendorConfigId;

                // load the record
                var recordData = vcs_recordsLib.searchTransaction({
                    recordNum: option.poNum,
                    recordId: option.poId,
                    type: ns_record.Type.PURCHASE_ORDER
                });
                if (!recordData)
                    throw {
                        message: 'Unable to load record - ',
                        detail: [option.poNum || option.poId]
                    };

                // load the main config
                MainCFG = vcs_configLib.mainConfig();

                // load the configuration
                VendorCFG = vcs_configLib.loadConfig({
                    poId: poId,
                    poNum: poNum,
                    configId: vendoCfgId,
                    configType: vcs_configLib.ConfigType.ORDER
                });
                if (!VendorCFG) throw 'Unable to load configuration';
                returnValue.prefix = VendorCFG.fulfillmentPrefix;
                returnValue.ConfigRec = VendorCFG;

                // get the Vendor Library
                var vendorLib = Helper.getVendorLibrary(VendorCFG);

                var outputResp = vendorLib.process({
                    poNum: poNum,
                    poId: poId,
                    orderConfig: VendorCFG
                });

                // validate shipped lines

                (outputResp.Lines || []).forEach(function (lineData) {
                    Helper.validateShipped(lineData);
                    return true;
                });

                // flatten the results
                Helper.flattenResults(outputResp);
                Helper.collectOrderLines(outputResp);

                util.extend(returnValue, outputResp);
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);

                util.extend(
                    util.extend(returnValue, { hasError: true }),
                    Helper.evaluateError(error) || {}
                );
            } finally {
                vc2_util.log(logTitle, '##### WEBSERVICE | Return: #####');
            }

            return returnValue;
        },
        DandHItemFetch: function (option) {
            var logTitle = [LogTitle, 'DandHItemFetch'].join(':'),
                returnValue = {};

            // Fixed: Guard option access to prevent runtime errors when called without arguments.
            option = option || {};

            vc2_util.log(logTitle, '###### WEBSERVICE: DandHItem: ######', option);
            try {
                var poId = option.poId,
                    vendorId = option.vendorId || option.vendor,
                    itemId = option.itemId || option.item,
                    itemList = option.itemList || option.items,
                    vendoCfgId = option.vendorConfigId;

                if (!itemId) throw 'Missing item identifier';
                if (!poId) throw 'Missing PO ID';

                // load the configuration
                var ConfigRec = vcs_configLib.loadConfig({
                    poId: poId,
                    configId: vendoCfgId,
                    configType: vcs_configLib.ConfigType.ORDER
                });
                if (!ConfigRec) throw 'Unable to load configuration';

                // get details about the item from cache first
                var cacheKey = ['DandHItem', itemId, vendorId].join('_');
                var itemData = vc2_util.getNSCache({ name: cacheKey, isJSON: true });
                if (!itemData) {
                    itemData = vc2_util.flatLookup({
                        type: 'item',
                        id: itemId,
                        columns: [
                            'itemid',
                            'name',
                            'upccode',
                            'type',
                            // 'isserialitem',
                            'mpn',
                            'recordtype'
                        ]
                    });
                    // set the cache
                    if (itemData) vc2_util.setNSCache({ name: cacheKey, data: itemData });
                }
                vc2_util.log(logTitle, '>> itemData: ', itemData);
                if (!itemData) throw 'Item not found';

                var arrItemNames = vc2_util.uniqueArray([
                    itemData.name,
                    itemData.itemid,
                    itemData.mpn,
                    itemData.upccode
                ]);

                // get data for each itemName
                var dnhItemDetails = null;
                arrItemNames.forEach(function (itemName) {
                    if (dnhItemDetails) return;

                    dnhItemDetails =
                        lib_dnh.processItemInquiry({
                            poId: poId,
                            orderConfig: ConfigRec,
                            itemName: itemName,
                            lookupType: 'MFR'
                        }) ||
                        lib_dnh.processItemInquiry({
                            poId: poId,
                            orderConfig: ConfigRec,
                            itemName: itemName,
                            lookupType: 'DH'
                        });
                });
                if (!dnhItemDetails) throw 'Item not found in DandH';

                var dnhItemValue;
                ['name', 'itemid', 'mpn', 'upccode'].forEach(function (itemkey) {
                    if (dnhItemValue) return;
                    if (
                        itemData[itemkey] &&
                        itemData[itemkey].toUpperCase() == dnhItemDetails.partNum.toUpperCase()
                    )
                        dnhItemValue = dnhItemDetails.itemNum;
                    else if (
                        itemData[itemkey] &&
                        itemData[itemkey].toUpperCase() == dnhItemDetails.itemNum.toUpperCase()
                    )
                        dnhItemValue = dnhItemDetails.partNum;
                });

                returnValue = {
                    item: itemData,
                    dnh: dnhItemDetails,
                    dnhValue: dnhItemValue
                };
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);

                util.extend(
                    util.extend(returnValue, { hasError: true }),
                    Helper.evaluateError(error) || {}
                );
            }

            return returnValue;
        },
        SendPO: function (option) {},
        GetBills: function (option) {}
    };

    return WebserviceLib;
});
