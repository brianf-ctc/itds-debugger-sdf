/**
 * Copyright (c) 2025 Catalyst Tech Corp
 * All Rights Reserved.
 *
 * This software is the confidential and proprietary information of
 * Catalyst Tech Corp. ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with Catalyst Tech.
 *
 * Module Name: VC Services | Cisco API
 * @author brianf@nscatalyst.com
 * @description Cisco PO status library and vendor connector for VC Services.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils'),
        vc2_constant = require('../../CTC_VC2_Constants'),
        ns_https = require('N/https');

    var LogTitle = 'WS:CiscoAPI';

    var CURRENT = {
            TokenName: 'VC_CISCO_TOKEN',
            CacheTTL: 43200 // 12 hrs cache
        },
        DATE_FIELDS = vc2_constant.DATE_FIELDS,
        ERROR_MSG = vc2_constant.ERRORMSG;
    var LibCiscoAPI = {
        ClosedStatus: ['CLOSED'],
        ValidShippedStatus: ['BOOKED'],
        ValidLineShippedStatus: [
            'BOOKED', // added back as shipped items may remain in BOOKED status aka please rely on ship date
            'SHIPPED',
            'EDELIVERED',
            'DELIVERED',
            'SUBSCRIPTION FULFILLMENT',
            'INVOICED'
        ],
        SubscriptionFields: [
            'subscription_id',
            'req_start_date',
            'est_start_date',
            'start_date',
            'end_date',
            'term',
            'renewal_term',
            'billing_model'
        ],
        generateToken: function () {
            var logTitle = [LogTitle, 'LibCiscoAPI::generateToken'].join('::'),
                returnValue,
                secStringBasicAuthHeader = ns_https.createSecureString({
                    input: 'Basic '
                }),
                secStringCredentials = ns_https.createSecureString({
                    input: CURRENT.orderConfig.apiKey + ':' + CURRENT.orderConfig.apiSecret
                });
            secStringCredentials.convertEncoding({
                fromEncoding: ns_https.Encoding.UTF_8,
                toEncoding: ns_https.Encoding.BASE_64
            });
            secStringBasicAuthHeader.appendSecureString({
                secureString: secStringCredentials,
                keepEncoding: true
            });
            var respToken = vc2_util.sendRequest({
                header: [LogTitle, 'Generate Token'].join(' '),
                method: 'post',
                recordId: CURRENT.recordId,
                query: {
                    url: CURRENT.orderConfig.accessEndPoint,
                    body: vc2_util.convertToQuery({
                        grant_type: 'client_credentials'
                    }),
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        Accept: 'application/json',
                        Authorization: secStringBasicAuthHeader
                    }
                }
            });
            vc2_util.handleJSONResponse(respToken);
            if (!respToken.PARSED_RESPONSE) throw 'Unable to generate token';
            returnValue = respToken.PARSED_RESPONSE.access_token;
            return returnValue;
        },
        getOrderDetails: function () {
            var logTitle = [LogTitle, 'LibCiscoAPI::getOrderDetails'].join('::'),
                returnValue;
            var ciscoOrderNum = CURRENT.recordNum,
                endpointUrl = CURRENT.orderConfig.endPoint;
            var respOrderDetails = vc2_util.sendRequest({
                header: [LogTitle, 'Order Details'].join(' '),
                method: 'post',
                recordId: CURRENT.recordId,
                query: {
                    url: endpointUrl,
                    body: JSON.stringify({
                        GetPurchaseOrder: {
                            value: {
                                DataArea: {
                                    PurchaseOrder: [
                                        {
                                            PurchaseOrderHeader: {
                                                ID: {
                                                    value: ciscoOrderNum
                                                },
                                                // 'DocumentReference': [{
                                                //     'ID': {
                                                //         'value': ""
                                                //     }
                                                // }],
                                                // 'ResellerPoNumber': [{
                                                //     'ID': {
                                                //         'value': ""
                                                //     }
                                                // }],
                                                // 'SalesOrderReference': [{
                                                //     'ID': {
                                                //         'value': ""
                                                //     }
                                                // }],
                                                Description: [
                                                    {
                                                        value: 'Yes',
                                                        typeCode: 'details'
                                                    }
                                                ]
                                            }
                                        }
                                    ]
                                },
                                ApplicationArea: {
                                    // 'CreationDateTime': new Date().toISOString(),
                                    BODID: {
                                        value: 'NS_Catalyst'
                                        // 'schemeVersionID': 'V1'
                                    }
                                }
                            }
                        }
                    }),
                    headers: {
                        Authorization: 'Bearer ' + CURRENT.accessToken,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    }
                }
            });
            if (respOrderDetails.isError) {
                throw respOrderDetails.errorMsg;
            }
            vc2_util.handleJSONResponse(respOrderDetails);
            if (vc2_util.isEmpty(respOrderDetails.PARSED_RESPONSE)) {
                throw 'Unable to fetch server response';
            }
            returnValue = respOrderDetails.PARSED_RESPONSE;
            return returnValue;
        },
        getSerialNumbers: function (option) {
            var logTitle = [LogTitle, 'LibCiscoAPI::getSerialNumbers'].join('::'),
                returnValue;
            var requestBody = null;
            if (option.webOrderNumber) {
                requestBody = {
                    webOrderId: option.webOrderNumber,
                    pageNumber: option.page + ''
                };
            } else if (option.salesOrderNumber) {
                requestBody = {
                    salesOrderNumber: option.salesOrderNumber,
                    pageNumber: option.page + ''
                };
            }
            if (requestBody) {
                var respSerialNumbers = vc2_util.sendRequest({
                    header: [LogTitle, 'Get Serial Numbers'].join(' '),
                    method: 'post',
                    recordId: CURRENT.recordId,
                    query: {
                        url: 'https://apix.cisco.com/commerce/ORDER/sync/getSerialNumbers',
                        body: JSON.stringify({
                            serialNumberRequest: requestBody
                        }),
                        headers: {
                            Authorization: 'Bearer ' + CURRENT.accessToken,
                            Accept: 'application/json',
                            'Content-Type': 'application/json'
                        }
                    }
                });
                if (respSerialNumbers.isError) {
                    vc2_util.logWarn(logTitle, respSerialNumbers.errorMsg);
                }
                if (!respSerialNumbers || vc2_util.isEmpty(respSerialNumbers.PARSED_RESPONSE)) {
                    returnValue = null;
                } else {
                    returnValue = respSerialNumbers.PARSED_RESPONSE;
                }
            }
            return returnValue;
        }
    };

    var LibOrderStatus = {
        getVendorValue: function (option) {
            var returnValue = option;
            if (option && util.isObject(option) && option.hasOwnProperty('value')) {
                returnValue = option.value;
            }
            if (vc2_util.isEmpty(returnValue)) {
                returnValue = null;
            }
            return returnValue;
        },
        initialize: function (option) {
            var logTitle = [LogTitle, 'LibOrderStatus::initialize'].join('::');
            CURRENT.recordId = option.poId || option.recordId;
            CURRENT.recordNum = option.poNum || option.transactionNum;
            CURRENT.orderConfig = option.orderConfig;
            if (!CURRENT.orderConfig) throw 'Missing vendor configuration';
            // Detect the endpoints
            var endPoint = CURRENT.orderConfig.endPoint;
            if (!endPoint) throw 'Missing end point configuration';
            vc2_util.LogPrefix = '[purchaseorder:' + (CURRENT.recordId || CURRENT.recordNum) + '] ';
        },
        getTokenCache: function () {
            var accessToken = vc2_util.getNSCache({
                key: [
                    CURRENT.TokenName,
                    CURRENT.orderConfig.apiKey,
                    CURRENT.orderConfig.subsidiary,
                    CURRENT.orderConfig.customerNo,
                    vc2_constant.IS_DEBUG_MODE ? new Date().getTime() : null
                ].join('|')
            });
            if (vc2_util.isEmpty(accessToken)) accessToken = LibCiscoAPI.generateToken();
            if (!vc2_util.isEmpty(accessToken)) {
                vc2_util.setNSCache({
                    key: CURRENT.TokenName,
                    cacheTTL: CURRENT.CacheTTL,
                    value: accessToken
                });
                CURRENT.accessToken = accessToken;
            }
            return accessToken;
        },
        extractLineData: function (ciscoLine, orderInfo) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractLineData'].join('::');
            var lineData = {
                order_num: orderInfo.VendorOrderNum || 'NA',
                order_status: orderInfo.Status || 'NA',
                order_date: orderInfo.OrderDate || 'NA',
                line_num: 'NA',
                so_line_num: 'NA',
                po_line_num: 'NA',
                line_status: 'NA',
                ship_date: 'NA',
                order_eta: 'NA',
                deliv_eta: 'NA',
                prom_date: 'NA',
                carrier: 'NA',
                tracking_num: 'NA',
                item_num: 'NA',
                ship_qty: 'NA',
                subscription_id: 'NA',
                req_start_date: 'NA',
                est_start_date: 'NA',
                start_date: 'NA',
                end_date: 'NA',
                term: 'NA',
                renewal_term: 'NA',
                billing_model: 'NA',
                deliv_date: 'NA', // no actual delivery dates in response
                item_num_alt: 'NA', // no alternate item number in response
                vendorSKU: 'NA', // no vendor SKUs in response
                serial_num: 'NA', // no serial numbers in response
                order_data: 'NA'
            };
            if (ciscoLine) {
                lineData.prom_date =
                    LibOrderStatus.getVendorValue(ciscoLine.PromisedShipDateTime) ||
                    lineData.prom_date;
                lineData.po_line_num =
                    LibOrderStatus.getVendorValue(ciscoLine.LineNumberID) || lineData.po_line_num;
                if (ciscoLine.Description && ciscoLine.Description.length) {
                    for (var i = 0, len = ciscoLine.Description.length; i < len; i += 1) {
                        var lineDesc = ciscoLine.Description[i] || {};
                        if (
                            lineDesc.typeCode &&
                            lineDesc.typeCode.toUpperCase() == 'SOLINENUMBER'
                        ) {
                            lineData.so_line_num =
                                LibOrderStatus.getVendorValue(lineDesc) || lineData.so_line_num;
                            break;
                        }
                    }
                } else if (
                    ciscoLine.SalesOrderReference &&
                    ciscoLine.SalesOrderReference.LineNumberID
                ) {
                    lineData.so_line_num =
                        LibOrderStatus.getVendorValue(ciscoLine.SalesOrderReference.LineNumberID) ||
                        lineData.so_line_num;
                }
                lineData.line_num = lineData.so_line_num;
                if (lineData.line_num == 'NA') {
                    lineData.line_num = lineData.po_line_num;
                }
                var lineStatus = {};
                if (ciscoLine.Status && ciscoLine.Status.length) {
                    lineStatus = ciscoLine.Status[0] || {};
                }
                if (lineStatus.Code) {
                    lineData.line_status =
                        LibOrderStatus.getVendorValue(lineStatus.Code) || lineData.line_status;
                } else if (
                    lineStatus.Extension &&
                    lineStatus.Extension.length &&
                    lineStatus.Extension[0] &&
                    lineStatus.Extension[0].Text &&
                    lineStatus.Extension[0].Text.length
                ) {
                    lineData.line_status =
                        LibOrderStatus.getVendorValue(lineStatus.Extension[0].Text[0]) ||
                        lineData.line_status;
                }
                var addLineData = {};
                // set status
                var lineStatusFields = lineStatus.Extension || [];
                lineStatusFields.forEach(function (statusData) {
                    if (statusData && statusData.typeCode) {
                        switch (statusData.typeCode.toUpperCase()) {
                            // hardware (aka traditional) shipment date
                            case 'SHIPMENTDATE':
                                lineData.ship_date =
                                    LibOrderStatus.getVendorValue(statusData.DateTime[0]) ||
                                    lineData.ship_date;
                                break;
                            case 'LINELEVELHOLD':
                                if (lineData.line_status == 'NA') {
                                    lineData.line_status =
                                        'Line Level Hold / ' +
                                        (LibOrderStatus.getVendorValue(statusData.Name) || '');
                                } else {
                                    lineData.line_status +=
                                        ' / Line Level Hold / ' +
                                        (LibOrderStatus.getVendorValue(statusData.Name) || '');
                                }
                                var holdReason = LibOrderStatus.getVendorValue(
                                    statusData.ValueText
                                );
                                if (holdReason) {
                                    addLineData.hold = holdReason;
                                }
                                break;
                            default:
                                break;
                        }
                    }
                });
                // set ETAs
                var ship_eta = null,
                    delivery_eta = null;
                if (ciscoLine.FulfillmentTerm && ciscoLine.FulfillmentTerm.length) {
                    for (var i = 0, len = ciscoLine.FulfillmentTerm.length; i < len; i += 1) {
                        var term = ciscoLine.FulfillmentTerm[i] || {};
                        if (term.RequestedShipDateTime) {
                            ship_eta = LibOrderStatus.getVendorValue(term.RequestedShipDateTime);
                        }
                        if (term.RequestDeliveryDate) {
                            delivery_eta = LibOrderStatus.getVendorValue(term.RequestDeliveryDate);
                        }
                        if (ship_eta && delivery_eta) {
                            break;
                        }
                    }
                }
                // promised delivery date or requested/estimated ship date for hardware
                lineData.order_eta =
                    LibOrderStatus.getVendorValue(ciscoLine.PromisedDeliveryDateTime) ||
                    ship_eta ||
                    lineData.order_eta;
                lineData.deliv_eta = delivery_eta || lineData.deliv_eta;
                // set item values
                var item = ciscoLine.Item;
                if (item) {
                    lineData.item_num = LibOrderStatus.getVendorValue(item.ID) || lineData.item_num;
                    lineData.ship_qty = (function (lots) {
                        var orderedQuantity = 0;
                        if (lots && lots.length) {
                            lots.forEach(function (lot) {
                                if (lot) {
                                    orderedQuantity +=
                                        +LibOrderStatus.getVendorValue(lot.Quantity) || 0;
                                }
                            });
                        }
                        return orderedQuantity;
                    })(item.Lot);
                }
                // set carrier and tracking values
                var shipment = ciscoLine.TransportStep;
                if (shipment && shipment.length && shipment[0]) {
                    lineData.carrier =
                        LibOrderStatus.getVendorValue(shipment[0].TransportationMethodCode) ||
                        lineData.carrier;
                    var shipmentTerms = shipment[0].TransportationTerm;
                    if (shipmentTerms && shipmentTerms.length && shipmentTerms[0]) {
                        var shipmentTermDesc = shipmentTerms[0].Description || [];
                        var trackingNos = [];
                        shipmentTermDesc.forEach(function (shipTermData) {
                            if (
                                shipTermData &&
                                shipTermData.typeCode &&
                                shipTermData.typeCode.toUpperCase() == 'TRACKING NUMBER'
                            ) {
                                var trackingNumber = shipTermData.value;
                                if (!vc2_util.isEmpty(trackingNumber)) {
                                    trackingNos.push(trackingNumber);
                                }
                            }
                        });
                        if (trackingNos.length) {
                            lineData.tracking_num = trackingNos.join(',');
                        }
                    }
                }
                /// get additional info
                var extension = ciscoLine.Extension;
                if (
                    extension &&
                    extension.length &&
                    extension[0] &&
                    extension[0].CiscoExtensionArea &&
                    extension[0].CiscoExtensionArea.SubscriptionDetail &&
                    extension[0].CiscoExtensionArea.SubscriptionDetail.value
                ) {
                    var subscription = LibOrderStatus.getVendorValue(
                        extension[0].CiscoExtensionArea.SubscriptionDetail
                    );
                    if (subscription) {
                        lineData.subscription_id =
                            LibOrderStatus.getVendorValue(subscription.ID) ||
                            lineData.subscription_id;
                        var serviceStartDate = LibOrderStatus.getVendorValue(
                            subscription.ServiceStartDate
                        );
                        if (serviceStartDate) {
                            lineData.req_start_date =
                                LibOrderStatus.getVendorValue(serviceStartDate.RequestedDate) ||
                                lineData.req_start_date;
                            lineData.est_start_date =
                                LibOrderStatus.getVendorValue(serviceStartDate.RequestedEndDate) ||
                                lineData.est_start_date;
                        }
                        var subscriptionTerms = LibOrderStatus.getVendorValue(
                            subscription.DurationAndTerm
                        );
                        if (subscriptionTerms) {
                            lineData.start_date =
                                LibOrderStatus.getVendorValue(subscriptionTerms.StartDateTime) ||
                                lineData.start_date;
                            lineData.end_date =
                                LibOrderStatus.getVendorValue(subscriptionTerms.EndDateTime) ||
                                lineData.end_date;
                            lineData.term =
                                LibOrderStatus.getVendorValue(subscriptionTerms.InitialTerm) ||
                                lineData.term;
                            lineData.renewal_term =
                                LibOrderStatus.getVendorValue(subscriptionTerms.AutoRenewalTerm) ||
                                lineData.renewal_term;
                        }
                        var billingInfo = LibOrderStatus.getVendorValue(subscription.BillingInfo);
                        if (billingInfo) {
                            lineData.billing_model =
                                LibOrderStatus.getVendorValue(billingInfo.BillingModel) ||
                                lineData.billing_model;
                        }
                    }
                }
                if (ciscoLine.typeCode && ciscoLine.typeCode.toUpperCase() == 'SUBSCRIPTION') {
                    // licenses and subscriptions are never shipped
                    lineData.ship_date = lineData.order_date;
                }
                // parse dates
                DATE_FIELDS.forEach(function (dateField) {
                    if (lineData[dateField] && lineData[dateField] != 'NA') {
                        lineData[dateField] = vc2_util.parseToVCDate(lineData[dateField]);
                    }
                });
                ['typeCode', 'ContractReference', 'Extension'].forEach(function (nodeData) {
                    if (ciscoLine[nodeData] && !vc2_util.isEmpty(ciscoLine[nodeData])) {
                        addLineData[nodeData] = ciscoLine[nodeData];
                    }
                });
                if (!vc2_util.isEmpty(addLineData)) {
                    lineData.order_data = JSON.stringify(addLineData);
                }
            }
            return lineData;
        },
        extractSerialLines: function (serialNumberDetl) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractSerialLines'].join('::'),
                returnValue = [];
            if (
                serialNumberDetl &&
                serialNumberDetl.serialNumberResponse &&
                serialNumberDetl.serialNumberResponse.serialDetails
            ) {
                var serialDetails = serialNumberDetl.serialNumberResponse.serialDetails;
                var serialLines = serialDetails.lines || [];
                serialLines.forEach(function (serialLine) {
                    if (serialLine) {
                        var serialNumList = serialLine.serialNumbers || [];
                        var serialData = {
                            OrderNum: serialDetails.purchaseOrderNumber || 'NA',
                            WebOrderNumber: serialDetails.webOrderID || 'NA',
                            PurchaseOrderNumber: serialDetails.purchaseOrderNumber || 'NA',
                            po_line_num: serialLine.poLineRef || 'NA',
                            so_line_num: serialLine.lineNumber || 'NA',
                            item_num: serialLine.partNumber || 'NA',
                            serial_numbers: [],
                            quantity: serialLine.quantity || 'NA',
                            ship_set_num: serialLine.shipSetNumber || 'NA'
                        };
                        serialNumList.forEach(function (serialNumObj) {
                            if (serialNumObj && !vc2_util.isEmpty(serialNumObj.serialNumber)) {
                                serialData.serial_numbers.push(serialNumObj.serialNumber);
                            }
                        });
                        returnValue.push(serialData);
                    }
                });
            }
            return returnValue;
        },
        processSerialsRequest: function (option) {
            var logTitle = [LogTitle, 'processSerialsRequest'].join('::'),
                returnValue = [];
            option = option || {};
            try {
                var pageCtr = 1,
                    totalPages = null;
                do {
                    var serialNumberDetl = LibCiscoAPI.getSerialNumbers({
                        salesOrderNumber: option.salesOrderNumber,
                        webOrderNumber: option.webOrderNumber,
                        page: pageCtr
                    });
                    if (
                        serialNumberDetl &&
                        serialNumberDetl.serialNumberResponse &&
                        serialNumberDetl.serialNumberResponse.responseHeader
                    ) {
                        if (
                            serialNumberDetl.serialNumberResponse.responseHeader.result &&
                            serialNumberDetl.serialNumberResponse.responseHeader.result.toUpperCase() ==
                                'SUCCESS'
                        ) {
                            if (
                                totalPages === null &&
                                serialNumberDetl.serialNumberResponse.responseHeader.totalPages
                            ) {
                                totalPages = parseInt(
                                    serialNumberDetl.serialNumberResponse.responseHeader.totalPages
                                );
                            }
                            returnValue.push(serialNumberDetl);
                        } else if (serialNumberDetl.serialNumberResponse.responseHeader.message) {
                            // error
                            vc2_util.logWarn(
                                logTitle,
                                serialNumberDetl.serialNumberResponse.responseHeader.message
                            );
                        } else {
                            // unexpected error
                            vc2_util.logWarn(
                                logTitle,
                                'Serials Response Result = ' +
                                    serialNumberDetl.serialNumberResponse.responseHeader.result
                            );
                        }
                    }
                    totalPages = totalPages || 1;
                    pageCtr += 1;
                } while (pageCtr <= totalPages);
            } catch (error) {
                vc2_util.logError(logTitle, error);
            }
            return returnValue;
        },
        supplementSerialNumbers: function (option) {
            if (option.items && option.serials) {
                option.items.forEach(function (lineData) {
                    var serialNumbers = [];
                    option.serials.forEach(function (serialData) {
                        if (
                            lineData &&
                            serialData &&
                            lineData.item_num == serialData.item_num &&
                            [serialData.SalesOrderNumber, serialData.WebOrderNumber].indexOf(
                                lineData.order_num
                            ) >= 0 &&
                            (lineData.po_line_num == serialData.po_line_num ||
                                lineData.so_line_num == serialData.so_line_num)
                        ) {
                            serialNumbers = serialNumbers.concat(serialData.serial_numbers);
                        }
                    });
                    if (serialNumbers.length) {
                        lineData.serial_num = serialNumbers.join(',');
                    }
                });
            }
        },
        getParentLineNum: function (lineData) {
            var returnValue = null;
            if (lineData && lineData.line_num) {
                var lineNum = lineData.line_num + '';
                returnValue = lineNum;
                var parentLineNumIndex = lineNum.lastIndexOf('.');
                if (parentLineNumIndex > 0) {
                    returnValue = lineNum.slice(0, parentLineNumIndex);
                }
            }
            return returnValue;
        },
        findLineDataByLineNum: function (items, lineNumToFind) {
            var returnValue = -1;
            if (items && items.length) {
                for (var i = 0, len = items.length; i < len; i += 1) {
                    if (items[i] && items[i].line_num) {
                        var lineNum = items[i].line_num + '';
                        if (lineNum == lineNumToFind) {
                            returnValue = i;
                            break;
                        }
                    }
                }
            }
            return returnValue;
        },
        mapLineNumHierarchy: function (items) {
            var returnValue = {};
            if (items && items.length) {
                items.forEach(function (lineData) {
                    var lineNumStr = lineData.line_num + '';
                    var ancestry = [lineNumStr];
                    var parentLineNumber = LibOrderStatus.getParentLineNum(lineData);
                    var childLineNumber = lineNumStr;
                    while (parentLineNumber && childLineNumber != parentLineNumber) {
                        var parentLineIndex = LibOrderStatus.findLineDataByLineNum(
                            items,
                            parentLineNumber
                        );
                        if (parentLineIndex >= 0) {
                            ancestry.push(parentLineNumber);
                            var parentLineData = items[parentLineIndex];
                            childLineNumber = parentLineNumber;
                            parentLineNumber = LibOrderStatus.getParentLineNum(parentLineData);
                        } else {
                            break;
                        }
                    }
                    var ancestorLineNum = ancestry[ancestry.length - 1];
                    var parentObj = returnValue[ancestorLineNum] || {};
                    returnValue[ancestorLineNum] = parentObj;
                    for (var i = ancestry.length - 2; i >= 0; i -= 1) {
                        var descendantLineNum = ancestry[i];
                        parentObj[descendantLineNum] = parentObj[descendantLineNum] || {};
                        ancestorLineNum = descendantLineNum;
                        parentObj = parentObj[descendantLineNum];
                    }
                });
            }
            return returnValue;
        },
        cascadeSubscriptionInfoToChilden: function (items, itemHierarchy) {
            if (itemHierarchy) {
                for (var lineNum in itemHierarchy) {
                    var parentLineDataIndex = LibOrderStatus.findLineDataByLineNum(items, lineNum);
                    var parentLineData = items[parentLineDataIndex];
                    var childItemHierarchy = itemHierarchy[lineNum];
                    for (var childLineNum in childItemHierarchy) {
                        var childLineDataIndex = LibOrderStatus.findLineDataByLineNum(
                            items,
                            childLineNum
                        );
                        var childLineData = items[childLineDataIndex];
                        LibCiscoAPI.SubscriptionFields.forEach(function (field) {
                            if (childLineData[field] == 'NA' && parentLineData[field] != 'NA') {
                                childLineData[field] = parentLineData[field];
                            }
                        });
                        LibOrderStatus.cascadeSubscriptionInfoToChilden(items, childItemHierarchy);
                    }
                }
            }
        },
        supplementMissingChildData: function (items) {
            if (items && items.length) {
                var itemHierarchy = LibOrderStatus.mapLineNumHierarchy(items);
                LibOrderStatus.cascadeSubscriptionInfoToChilden(items, itemHierarchy);
            }
        }
    };

    return {
        process: function (option) {
            var logTitle = [LogTitle, 'process'].join('::'),
                returnValue = {};
            option = option || {};
            var OUTPUT = {
                OrdersList: [],
                Items: []
            };
            try {
                // get the validOrders
                var ciscoOrderResponse = this.processRequest(option);
                if (option.debugMode) {
                    if (!option.showLines) return ciscoOrderResponse;
                }
                // process response
                if (
                    ciscoOrderResponse.ShowPurchaseOrder &&
                    ciscoOrderResponse.ShowPurchaseOrder.value &&
                    ciscoOrderResponse.ShowPurchaseOrder.value.DataArea
                ) {
                    if (
                        ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show &&
                        ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show.ResponseCriteria &&
                        ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show
                            .ResponseCriteria[0] &&
                        ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show.ResponseCriteria[0]
                            .ResponseExpression &&
                        ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show.ResponseCriteria[0]
                            .ResponseExpression.value
                    ) {
                        if (
                            ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show.ResponseCriteria[0].ResponseExpression.value.toUpperCase() ==
                            'SUCCESS'
                        ) {
                            var poStatus =
                                ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.PurchaseOrder ||
                                [];
                            poStatus.forEach(function (orderDetail) {
                                if (orderDetail) {
                                    var orderHeaders = orderDetail.PurchaseOrderHeader;
                                    if (orderHeaders) {
                                        var orderInfo = {
                                            Status:
                                                orderHeaders.Status &&
                                                orderHeaders.Status.length &&
                                                orderHeaders.Status[0]
                                                    ? LibOrderStatus.getVendorValue(
                                                          orderHeaders.Status[0].Description
                                                      ) || 'NA'
                                                    : 'NA',
                                            OrderNum:
                                                LibOrderStatus.getVendorValue(orderHeaders.ID) ||
                                                'NA',
                                            WebOrderNumber: (function (documentReferences) {
                                                var webOrderNum = 'NA';
                                                if (
                                                    documentReferences &&
                                                    documentReferences.length
                                                ) {
                                                    for (
                                                        var i = 0, len = documentReferences.length;
                                                        i < len;
                                                        i += 1
                                                    ) {
                                                        var docRef = documentReferences[i];
                                                        if (
                                                            docRef.typeCode &&
                                                            docRef.typeCode.toUpperCase() ==
                                                                'WEBORDER_ID'
                                                        ) {
                                                            webOrderNum =
                                                                LibOrderStatus.getVendorValue(
                                                                    docRef.ID
                                                                ) || webOrderNum;
                                                            break;
                                                        }
                                                    }
                                                }
                                                return webOrderNum;
                                            })(orderHeaders.DocumentReference),
                                            SalesOrderNumber:
                                                orderHeaders.SalesOrderReference &&
                                                orderHeaders.SalesOrderReference.length &&
                                                orderHeaders.SalesOrderReference[0]
                                                    ? LibOrderStatus.getVendorValue(
                                                          orderHeaders.SalesOrderReference[0].ID
                                                      ) || 'NA'
                                                    : 'NA',
                                            OrderDate:
                                                vc2_util.parseToVCDate(
                                                    orderHeaders.OrderDateTime
                                                ) || 'NA',
                                            QuoteOrderNum:
                                                orderHeaders.QuoteReference &&
                                                orderHeaders.QuoteReference.length &&
                                                orderHeaders.QuoteReference[0]
                                                    ? LibOrderStatus.getVendorValue(
                                                          orderHeaders.QuoteReference[0].ID
                                                      ) || 'NA'
                                                    : 'NA',
                                            Total:
                                                LibOrderStatus.getVendorValue(
                                                    orderHeaders.TotalAmount
                                                ) || 'NA',
                                            VendorOrderNum: 'NA',
                                            InvoiceNo: 'NA',
                                            Source: ciscoOrderResponse
                                        };
                                        orderInfo.VendorOrderNum =
                                            orderInfo.WebOrderNumber ||
                                            orderInfo.SalesOrderNumber ||
                                            orderInfo.OrderNum;
                                        OUTPUT.OrdersList.push(orderInfo);
                                        var ciscoLines = orderDetail.PurchaseOrderLine || [];
                                        ciscoLines.forEach(function (ciscoLine) {
                                            var lineData = LibOrderStatus.extractLineData(
                                                ciscoLine,
                                                orderInfo
                                            );
                                            util.extend(lineData, {
                                                is_shipped:
                                                    (LibCiscoAPI.ValidShippedStatus.indexOf(
                                                        orderInfo.Status.toUpperCase()
                                                    ) >= 0 &&
                                                        LibCiscoAPI.ValidLineShippedStatus.indexOf(
                                                            lineData.line_status.toUpperCase()
                                                        ) >= 0) ||
                                                    LibCiscoAPI.ClosedStatus.indexOf(
                                                        orderInfo.Status.toUpperCase()
                                                    ) >= 0
                                            });
                                            OUTPUT.Items.push(lineData);
                                        });
                                        LibOrderStatus.supplementMissingChildData(OUTPUT.Items);
                                    }
                                }
                            });
                        } else {
                            // error
                            vc2_util.logError(
                                logTitle,
                                ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show
                                    .ResponseCriteria[0].ResponseExpression.value
                            );
                            throw JSON.stringify(
                                ciscoOrderResponse.ShowPurchaseOrder.value.DataArea.Show
                                    .ResponseCriteria[0].ResponseExpression.value
                            );
                        }
                    } else {
                        throw 'Unexpected server response';
                    }
                    ciscoOrderResponse.serials = {};
                    var processedWebOrderIds = {},
                        processedSalesOrderNumbers = {};
                    OUTPUT.OrdersList.forEach(function (orderInfo) {
                        if (orderInfo) {
                            if (
                                !processedWebOrderIds[orderInfo.WebOrderNumber] &&
                                !processedSalesOrderNumbers[orderInfo.SalesOrderNumber]
                            ) {
                                vc2_util.log(logTitle, '... processing: ', {
                                    SalesOrderNumber: orderInfo.SalesOrderNumber,
                                    WebOrderNumber: orderInfo.WebOrderNumber
                                });
                                var serialDetails = LibOrderStatus.processSerialsRequest({
                                    salesOrderNumber: orderInfo.SalesOrderNumber,
                                    webOrderNumber: orderInfo.WebOrderNumber
                                });
                                ciscoOrderResponse.serials[orderInfo.VendorOrderNum] =
                                    serialDetails;
                                processedSalesOrderNumbers[orderInfo.SalesOrderNumber] = true;
                                processedWebOrderIds[orderInfo.WebOrderNumber] = true;
                                vc2_util.log(
                                    logTitle,
                                    '... >> serial results count = ',
                                    serialDetails.length
                                );
                                serialDetails.forEach(function (serialNumberDetl) {
                                    vc2_util.log(logTitle, '... >> result: ', serialNumberDetl);
                                    LibOrderStatus.supplementSerialNumbers({
                                        items: OUTPUT.Items,
                                        serials: LibOrderStatus.extractSerialLines(serialNumberDetl)
                                    });
                                });
                            }
                        }
                    });
                    returnValue = {
                        Orders: OUTPUT.OrdersList,
                        Lines: OUTPUT.Items,
                        Source: ciscoOrderResponse
                    };
                }
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            } finally {
                vc2_util.log(logTitle, '// Return', returnValue);
            }
            return returnValue;
        },
        processRequest: function (option) {
            var logTitle = [LogTitle, 'processRequest'].join('::'),
                returnValue = [];
            option = option || {};
            try {
                LibOrderStatus.initialize(option);
                LibOrderStatus.getTokenCache(option);
                if (!CURRENT.accessToken) throw 'Unable to retrieve access token';
                returnValue = LibCiscoAPI.getOrderDetails();
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }
            return returnValue;
        }
    };
});
