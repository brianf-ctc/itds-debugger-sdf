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
 * Module Name: VC Services | ScanSource API
 * @author shawn.blackburn
 * @description Helper library for ScanSource to Get PO Status and related updates.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils'),
        vc2_constant = require('../../CTC_VC2_Constants');

    var LogTitle = 'WS:ScanSource',
        LogPrefix,
        CURRENT = { accessToken: null },
        DATE_FIELDS = vc2_constant.DATE_FIELDS,
        ERROR_MSG = vc2_constant.ERRORMSG,
        LogStatus = vc2_constant.LIST.VC_LOG_STATUS;

    var DEFAULT_SUBSCRIPTION_KEY = '4c83c3da-f5e5-4901-954f-399ef8175603';

    var LibScansource = {
        SkippedStatus: ['CANCELLED', 'ON HOLD', 'QUOTATION/SALES'],
        ShippedStatus: ['COMPLETELY SHIPPED', 'PARTIALLY SHIPPED'],
        initialize: function (option) {
            var logTitle = [LogTitle, 'initialize'].join('::'),
                returnValue;

            CURRENT.recordId = option.poId || option.recordId || CURRENT.recordId;
            CURRENT.recordNum = option.poNum || option.transactionNum || CURRENT.recordNum;
            CURRENT.orderConfig = option.orderConfig || CURRENT.orderConfig;
            vc2_util.LogPrefix = '[purchaseorder:' + (CURRENT.recordId || CURRENT.recordNum) + '] ';

            if (!CURRENT.orderConfig) throw 'Missing vendor configuration!';

            return returnValue;
        },
        generateToken: function (option) {
            var logTitle = [LogTitle, 'generateToken'].join('::'),
                returnValue;
            option = option || {};

            try {
                var tokenReq = vc2_util.sendRequest({
                    header: [LogTitle, 'Generate Token'].join(' '),
                    method: 'post',
                    recordId: CURRENT.recordId,
                    query: {
                        url: CURRENT.orderConfig.accessEndPoint,
                        body: vc2_util.convertToQuery({
                            client_id: CURRENT.orderConfig.apiKey,
                            client_secret: CURRENT.orderConfig.apiSecret,
                            grant_type: 'client_credentials',
                            scope: CURRENT.orderConfig.oauthScope
                        }),
                        headers: {
                            'Ocp-Apim-Subscription-Key':
                                CURRENT.orderConfig.subscriptionKey || DEFAULT_SUBSCRIPTION_KEY,
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    }
                });
                vc2_util.handleJSONResponse(tokenReq);
                var tokenResp = tokenReq.PARSED_RESPONSE;

                if (!tokenResp || !tokenResp.access_token) throw 'Unable to generate token';

                returnValue = tokenResp.access_token;
                CURRENT.accessToken = tokenResp.access_token;
            } catch (error) {
                throw error;
            } finally {
                vc2_util.log(logTitle, '>> Access Token: ', returnValue);
            }

            return returnValue;
        },
        getTokenCache: function () {
            var token = vc2_util.getNSCache({
                key: [
                    'VC_SCANSOURCE_TOKEN',
                    CURRENT.orderConfig.apiKey,
                    CURRENT.orderConfig.subscriptionKey,
                    CURRENT.orderConfig.subsidiary,
                    vc2_constant.IS_DEBUG_MODE ? new Date().getTime() : null
                ].join('|')
            });
            if (vc2_util.isEmpty(token)) token = this.generateToken();

            if (!vc2_util.isEmpty(token)) {
                vc2_util.setNSCache({
                    key: 'VC_SCANSOURCE_TOKEN_00',
                    cacheTTL: 3599,
                    value: token
                });
                CURRENT.accessToken = token;
            }
            return token;
        },
        getOrders: function (option) {
            var logTitle = [LogTitle, 'getOrders'].join('::'),
                returnValue;
            try {
                var reqOrderList = vc2_util.sendRequest({
                    header: [LogTitle, 'Orders List'].join(' : '),
                    recordId: CURRENT.recordId,
                    method: 'get',
                    query: {
                        url:
                            CURRENT.orderConfig.endPoint +
                            ('/list?customerNumber=' + CURRENT.orderConfig.customerNo) +
                            ('&poNumber=' + CURRENT.recordNum),
                        headers: {
                            Authorization: 'Bearer ' + CURRENT.accessToken,
                            'Content-Type': 'application/json',
                            'Ocp-Apim-Subscription-Key':
                                CURRENT.orderConfig.subscriptionKey || DEFAULT_SUBSCRIPTION_KEY
                        }
                    }
                });
                vc2_util.handleJSONResponse(reqOrderList);
                if (!reqOrderList.PARSED_RESPONSE) throw 'Unable to fetch server response';

                if (vc2_util.isEmpty(reqOrderList.PARSED_RESPONSE))
                    throw 'No orders found for the PO';

                returnValue = reqOrderList.PARSED_RESPONSE;
            } catch (error) {
                throw error;
            }
            return returnValue;
        },
        getOrderDetails: function (option) {
            var logTitle = [LogTitle, 'getOrderDetails'].join('::'),
                returnValue;
            try {
                var reqOrderDetails = vc2_util.sendRequest({
                    header: [LogTitle, 'Order Details'].join(' : '),
                    recordId: CURRENT.recordId,
                    method: 'get',
                    query: {
                        url:
                            CURRENT.orderConfig.endPoint +
                            ('/detail?salesOrderNumber=' +
                                option.OrderNumber +
                                '&customerNumber=') +
                            (CURRENT.orderConfig.customerNo + '&excludeSerialTracking=false'),
                        headers: {
                            Authorization: 'Bearer ' + CURRENT.accessToken,
                            'Content-Type': 'application/json',
                            'Ocp-Apim-Subscription-Key':
                                CURRENT.orderConfig.subscriptionKey || DEFAULT_SUBSCRIPTION_KEY
                        }
                    }
                });
                vc2_util.handleJSONResponse(reqOrderDetails);
                if (!reqOrderDetails.PARSED_RESPONSE) throw 'Unable to fetch server response';

                returnValue = reqOrderDetails.PARSED_RESPONSE;
            } catch (error) {
                throw error;
            }
            return returnValue;
        },
        getInvoiceNumbers: function (payload) {
            if (!payload || typeof payload !== 'object') {
                return [];
            }

            // Find the key (case-insensitive)
            var keyFound = null;
            for (var k in payload) {
                if (Object.prototype.hasOwnProperty.call(payload, k)) {
                    var lk = String(k).toLowerCase();
                    if (lk === 'invoicenumbers' || lk === 'invoicenmbers') {
                        keyFound = k;
                        break;
                    }
                }
            }

            if (!keyFound) {
                return [];
            }

            var raw = payload[keyFound];
            var result = [];

            // If it's a single string
            if (typeof raw === 'string') {
                var trimmed = raw.replace(/^\s+|\s+$/g, '');
                if (trimmed) {
                    result.push(trimmed);
                }
                return result;
            }

            // If it's an array (or array-like with length)
            if (raw && typeof raw.length === 'number') {
                for (var i = 0; i < raw.length; i++) {
                    var v = raw[i];
                    if (v !== null && v !== undefined) {
                        var s = String(v).replace(/^\s+|\s+$/g, '');
                        if (s) {
                            result.push(s);
                        }
                    }
                }
                return result;
            }
            // Anything else -> empty
            return [];
        },
        getInvoiceDetails: function (invoiceNum) {
            var respInvoiceDetail = vc2_util.sendRequest({
                header: [LogTitle, 'Invoice Detail'].join(' '),
                method: 'get',
                recordId: CURRENT.recordId,
                query: {
                    url:
                        'https://api.scansource.com/scsc/invoice/v1' +
                        ('/detail?customerNumber=' +
                            CURRENT.orderConfig.customerNo +
                            '&InvoiceNumber=' +
                            invoiceNum),
                    headers: {
                        'Ocp-Apim-Subscription-Key':
                            CURRENT.orderConfig.subscriptionKey || DEFAULT_SUBSCRIPTION_KEY,
                        Authorization: 'Bearer ' + CURRENT.accessToken,
                        'Content-Type': 'application/json'
                    }
                }
            });

            vc2_util.handleJSONResponse(respInvoiceDetail);
            if (!respInvoiceDetail.PARSED_RESPONSE)
                throw 'Unable to fetch server response - getTrackingNum';
            return respInvoiceDetail.PARSED_RESPONSE;
        },
        /**
         * @return {Array}
         * sample output:
         * [{
         *   ItemNumber: '12345',
         *   ProductMfrPart: 'Product Name',
         *   TrackingNumber: ['TN123', 'TN124']
         * }]
         */
        getTrackingNum: function (option) {
            var logTitle = [LogTitle, 'getTrackingNum'].join('::');

            //get invoice numbers from the payload
            var arrInvoices = this.getInvoiceNumbers(option.payload);
            var arrTrackingInfo = [];

            //get tracking number for each invoice number
            for (var i = 0; i < arrInvoices.length; i++) {
                var invoiceNum = arrInvoices[i];

                var responseBody = this.getInvoiceDetails(invoiceNum);
                arrTrackingInfo = arrTrackingInfo.concat(
                    this.getTrackingFromShipment(responseBody)
                );
                vc2_util.waitMs(500);
            }
            return arrTrackingInfo;
        },
        /**
         * @return {Array}
         * sample output:
         * [{
         *   ItemNumber: '12345',
         *   ProductMfrPart: 'Product Name',
         *   TrackingNumber: ['TN123', 'TN124']
         * }]
         */
        getTrackingFromShipment: function (payload) {
            //not AI sorry for inefficiency
            var arrTracking = [];

            var arrInvoiceLines = payload.InvoiceLines;
            var invoiceNumber = payload.InvoiceNumber;
            var arrItemWithTrackingNum = [];

            if (!Array.isArray(arrInvoiceLines) || arrInvoiceLines.length == 0) {
                throw 'No invoice lines found for invoice ' + invoiceNumber;
            }
            arrInvoiceLines.forEach(function (invoiceLines) {
                //get shipments for this invoice line
                var arrShipments = invoiceLines.Shipments;
                var itemNumber = invoiceLines.ItemNumber;
                var itemName = invoiceLines.ProductMfrPart;
                var lineNumber = invoiceLines.LineNumber;

                //find existing item number in the array
                var arrItem = arrItemWithTrackingNum.filter(function (objData) {
                    return objData.ItemNumber === itemNumber;
                });

                //create object if not found - this is where we store the tracking numbers and item data
                if (!arrItem || arrItem.length == 0) {
                    arrItemWithTrackingNum.push({
                        ItemNumber: itemNumber,
                        ProductMfrPart: itemName,
                        InvoiceNumber: invoiceNumber,
                        TrackingNumber: [],
                        LineNumber: lineNumber
                    });
                }

                //get shippments for this invoice line
                arrShipments.forEach(function (shipments) {
                    var trackingNum = shipments.TrackingNumber;
                    if (vc2_util.isEmpty(trackingNum)) {
                        return;
                    }

                    //get the item object to push the tracking number
                    var arrResult = arrItemWithTrackingNum.filter(function (objData) {
                        return objData.ItemNumber === itemNumber;
                    });

                    //push the tracking number to the item object
                    if (Array.isArray(arrResult) && typeof arrResult[0] !== 'undefined') {
                        arrResult[0].TrackingNumber.push(trackingNum);
                    }
                });
            });
            return arrItemWithTrackingNum;
        }
    };

    return {
        process: function (option) {
            var logTitle = [LogTitle, 'process'].join('::'),
                returnValue = {};

            try {
                var arrResponse = this.processRequest(option);
                if (!arrResponse) throw 'Empty response';

                if (option.debugMode) {
                    if (!option.showLines) return arrResponse;
                }

                var itemInfoList = [],
                    deliveryInfoList = [],
                    itemArray = [],
                    orderList = [];

                arrResponse.forEach(function (orderDetail) {
                    var orderInfo = {
                        Status: orderDetail.Status || 'NA',
                        OrderNum: orderDetail.PONumber || 'NA',
                        VendorOrderNum:
                            orderDetail.SalesOrderNumber || orderDetail.EndUserPO || 'NA',
                        OrderDate: vc2_util.formatToVCDate(orderDetail.DateEntered || 'NA'),
                        Total: orderDetail.Total || 'NA',
                        InvoiceNo: 'NA',
                        Source: orderDetail
                    };

                    if (
                        vc2_util.inArray(
                            orderInfo.Status.toUpperCase(),
                            LibScansource.SkippedStatus
                        )
                    )
                        return true;

                    orderList.push(orderInfo);

                    //get tracking number from invoice details
                    var arrTrackingNumberFromInvoice = LibScansource.getTrackingNum({
                        payload: orderDetail
                    });
                    log.debug('arrTrackingNumberFromInvoice', arrTrackingNumberFromInvoice);

                    (orderDetail.SalesOrderLines || []).forEach(function (orderLine) {
                        var itemObj = {
                            order_num: orderInfo.VendorOrderNum,
                            order_status: orderInfo.Status,

                            order_date: orderInfo.OrderDate, // this is already parsed date
                            ship_date: 'NA',
                            order_eta: 'NA',
                            delivery_eta: 'NA',
                            deliv_date: 'NA',
                            prom_date: 'NA',

                            item_num: orderLine.ProductMfrPart,
                            item_num_alt: 'NA',
                            vendorSKU: orderLine.ItemNumber,
                            item_sku: orderLine.ItemNumber,

                            ship_qty: orderLine.Shipped || 'NA',
                            unitprice: vc2_util.parseFloat(orderLine.Price),
                            line_price: vc2_util.parseFloat(orderLine.Price),

                            line_num: orderLine.LineNumber || 'NA',
                            line_status: 'NA',
                            carrier: 'NA',
                            tracking_num: 'NA',
                            serial_num: 'NA',
                            is_shipped: vc2_util.inArray(
                                orderInfo.Status.toUpperCase(),
                                LibScansource.ShippedStatus
                            )
                        };

                        if (!vc2_util.isEmpty(orderLine.SerialNumbers))
                            itemObj.serial_num = orderLine.SerialNumbers.join(',');

                        (orderLine.ScheduleLines || []).forEach(function (scheduleLine) {
                            itemObj.order_eta = vc2_util.formatToVCDate(scheduleLine.EstimatedShipDate) || 'NA';
                        });

                        //get tracking number(s) for this item from the invoice tracking info
                        var trackingNum = arrTrackingNumberFromInvoice.filter(function (objData) {
                            return (objData.ItemNumber === orderLine.ItemNumber && objData.LineNumber == orderLine.LineNumber);
                        });
                        if (
                            Array.isArray(trackingNum) &&
                            typeof trackingNum[0] !== 'undefined' &&
                            Array.isArray(trackingNum[0].TrackingNumber)
                        ) {
                            itemObj.tracking_num = trackingNum[0].TrackingNumber.join(',') || 'NA';
                        }

                        vc2_util.log(logTitle, '...itemObj: ', itemObj);
                        itemArray.push(itemObj);
                    });
                    vc2_util.log(logTitle, '// itemInfoList:', itemInfoList);

                    // procedss the deliveries
                    (orderDetail.Deliveries || []).forEach(function (deliveryLine) {
                        var shipment = { tracking: [] };

                        (deliveryLine.Parcels || []).forEach(function (parcel) {
                            if (parcel.CarrierCode) shipment.carrier = parcel.CarrierCode;
                            if (
                                parcel.TrackingNumber &&
                                !vc2_util.inArray(parcel.TrackingNumber, shipment.tracking)
                            )
                                shipment.tracking.push(parcel.TrackingNumber);
                        });
                        vc2_util.log(logTitle, '...shipment:  ', shipment);

                        (deliveryLine.LineItems || []).forEach(function (lineItem) {
                            var orderItem = {
                                order_date: vc2_util.formatToVCDate(orderDetail.DateEntered) || 'NA',
                                order_num: orderDetail.SalesOrderNumber,
                                line_num: lineItem.DeliveryDocumentLineNumber
                                    ? lineItem.DeliveryDocumentLineNumber
                                    : null,
                                vendorSKU: lineItem.ItemNumber,
                                ship_qty: parseInt(lineItem.QuantityShipped),
                                ship_date: vc2_util.formatToVCDate(deliveryLine.ShippedDate) || 'NA',
                                carrier: shipment.carrier,
                                tracking_num: shipment.tracking.join(', ')
                            };

                            var arrSerials = [];
                            (lineItem.LineItemDetails || []).forEach(function (lineDetail) {
                                if (
                                    !vc2_util.isEmpty(lineDetail.SerialNumber) &&
                                    !vc2_util.inArray(lineDetail.SerialNumber, arrSerials)
                                )
                                    arrSerials.push(lineDetail.SerialNumber);
                            });
                            orderItem.serial_num = arrSerials.join(',');

                            vc2_util.log(logTitle, '...orderItem: ', orderItem);
                            deliveryInfoList.push(orderItem);
                        });

                        return true;
                    });

                    /// check the tracking outside the Delivery Info
                    // var trackingList = [];
                    // (orderDetail.TrackingNumbers || []).forEach(function (trackNum) {
                    //     if (!vc2_util.inArray(trackNum, trackingList)) trackingList.push(trackNum);
                    // });
                    // if (trackingList.length) {
                    //     itemArray.forEach(function (itemObj) {
                    //         if (
                    //             itemObj.is_shipped &&
                    //             (!itemObj.tracking_num || itemObj.tracking_num == 'NA')
                    //         )
                    //             itemObj.tracking_num = trackingList.join(', ');
                    //     });
                    // }
                });
                //end for each arr response
                vc2_util.log(logTitle, '// Order List:', orderList);
                vc2_util.log(logTitle, '// Item Entries:', itemArray);
                vc2_util.log(logTitle, '// Delivery Info:', deliveryInfoList);

                // merge both itemARray and deliveryArray, using the itemArray.vendorSKU as the key
                (deliveryInfoList || []).forEach(function (deliveryItem) {
                    var matchedItems = vc2_util.findMatching({
                        list: itemArray,
                        findAll: true,
                        filter: { vendorSKU: deliveryItem.vendorSKU }
                    });

                    vc2_util.log(logTitle, '// matching sku: ', [deliveryItem, matchedItems]);
                    if (!matchedItems || !matchedItems.length) return true;

                    (matchedItems || []).forEach(function (itemMatch) {
                        util.extend(itemMatch, deliveryItem);
                    });
                });

                // run through itemArray and check for DATE_FIELDS
                vc2_util.log(logTitle, 'itemArray: ', itemArray);
                itemArray.forEach(function (itemObj) {
                    DATE_FIELDS.forEach(function (dateField) {
                        if (!itemObj[dateField] || itemObj[dateField] == 'NA') return;
                        // skip the order_date
                        if (dateField == 'order_date') return;

                        var parsedDate = vc2_util.formatToVCDate(itemObj[dateField]);

                        itemObj[dateField] =
                            parsedDate && !parsedDate.match(/Invalid/i)
                                ? parsedDate
                                : itemObj[dateField];
                    });
                });
                util.extend(returnValue, {
                    Orders: orderList,
                    Lines: itemArray,
                    Source: arrResponse
                });

                // return arr
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        },
        processRequest: function (option) {
            var logTitle = [LogTitle, 'processRequest'].join('::'),
                returnValue;
            option = option || {};
            try {
                LibScansource.initialize(option);
                LibScansource.getTokenCache();
                if (!CURRENT.accessToken) throw 'Unable to generate access token';

                var arrPOResponse = LibScansource.getOrders();
                if (!arrPOResponse) throw 'Unable to get transaction lists for PO';

                vc2_util.log(logTitle, '>> Order List: ', arrPOResponse);

                var arrReturnResp = [];
                arrPOResponse.forEach(function (orderData) {
                    var respDetails = LibScansource.getOrderDetails(orderData);

                    respDetails.DateEntered = orderData.DateEntered;
                    if (respDetails) arrReturnResp.push(respDetails);
                });

                returnValue = arrReturnResp;
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }
            return returnValue;
        }
    };
});
