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
 * Module Name: VC Bill Creator | Carahsoft API
 *
 * @author ajdeleon
 * @description Vendor connector for Carahsoft API to retrieve invoice and order details.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-04-21   brianf                CST-5022: Switched bill-create vendor dates to vc2_util.formatToVCDate
 * 2026-02-27   brianf                Updated script header for standards compliance
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils');
    var LogTitle = 'WS:CarashsoftAPI',
        EntryPoint = {},
        TransId = '',
        ORDER_ID = '';

    EntryPoint.getInvoice = function (recordId, config) {
        TransId = recordId;

        //get the item details from order and merge with the invoice data
        var responseBodyorder = getOrderDetails(config);
        getOrderID(responseBodyorder);

        //get invoice details and normalize the data
        var responseBody = getInvoiceDetails(recordId, config);
        var arrInvoiceData = formatInvoiceJson(responseBody);

        //normalize the data
        var arrData = formatOrderJson(responseBodyorder, arrInvoiceData);

        return arrData;
    };

    function getInvoiceDetails(recordId, config) {
        var logTitle = [LogTitle, 'getInvoiceDetails'].join('::');

        var objHeaders = {
            Authorization: getTokenCache(config),
            'Content-Type': 'application/json',
            'X-Account': config.partner_id
        };
        // var invoiceListUrl = config.url+'/Invoice/DocNumber='+invDocNum+',Order_ID='+config.poNum;
        var invoiceListUrl = config.url + '/Invoice?$filter=Order_ID eq ' + ORDER_ID;
        // var invoiceListUrl = config.url + '/Invoice/' + ORDER_ID;
        var objResponse = vc2_util.sendRequest({
            header: logTitle,
            recordId: TransId,
            query: {
                url: invoiceListUrl,
                headers: objHeaders
            }
        });

        vc2_util.handleJSONResponse(objResponse);

        var searchOrderResp = objResponse.PARSED_RESPONSE || objResponse.RESPONSE || {};
        if (objResponse.isError || vc2_util.isEmpty(searchOrderResp)) {
            throw (
                objResponse.errorMsg +
                (objResponse.details ? '\n' + JSON.stringify(objResponse.details) : '')
            );
        }
        return searchOrderResp;
    }

    function getOrderDetails(config) {
        var logTitle = [LogTitle, 'getOrderDetails'].join('::');

        var objHeaders = {
            Authorization: getTokenCache(config),
            'X-Account': config.partner_id,
            'Content-Type': 'application/json',
            Connection: 'keep-alive'
        };

        var orderListUrl =
            config.url +
            "/Order/?$filter=CustomerPO eq '" +
            config.poNum +
            "'&$expand=Details($expand=LineItems)";
        var objResponse = vc2_util.sendRequest({
            header: logTitle,
            recordId: TransId,
            query: {
                headers: objHeaders,
                url: orderListUrl
            }
        });

        vc2_util.handleJSONResponse(objResponse);

        var searchOrderResp = objResponse.PARSED_RESPONSE || objResponse.RESPONSE || {};
        if (objResponse.isError || vc2_util.isEmpty(searchOrderResp)) {
            throw (
                objResponse.errorMsg +
                (objResponse.details ? '\n' + JSON.stringify(objResponse.details) : '')
            );
        }
        return searchOrderResp;
    }

    function formatInvoiceJson(responseBody) {
        log.debug('formatInvoiceJson | responseBody', responseBody);
        if (!responseBody) {
            return;
        }

        if (!vc2_util.isEmpty(responseBody.Queryable)) {
            responseBody = responseBody.Queryable;
        } else if (!vc2_util.isEmpty(responseBody.value)) {
            responseBody = responseBody.value;
        }

        var arrInvoiceData = [],
            objInvoice = '',
            objData = '';

        if (Array.isArray(responseBody)) {
            for (var i = 0; i < responseBody.length; i++) {
                objInvoice = responseBody[i];
                objData = {};

                objData.po = objInvoice.CustomerPO;
                objData.date = vc2_util.formatToVCDate(objInvoice.DocDate);
                objData.invoice = objInvoice.DocNumber;
                objData.total = objInvoice.Total;

                //additional info
                objData.invoiceid = objInvoice.Invoice_ID;
                objData.datepaid = objInvoice.DatePaid;
                objData.balance = objInvoice.Balance;
                objData.orderid = objInvoice.Order_ID;

                //charges
                objData.charges = {
                    tax: 0,
                    other: 0,
                    shipping: 0
                };

                arrInvoiceData.push({ ordObj: objData });
            }
        } else {
            objData = {};
            objInvoice = responseBody;

            objData.po = objInvoice.Order_ID;
            objData.date = vc2_util.formatToVCDate(objInvoice.DocDate);
            objData.invoice = objInvoice.DocNumber;
            objData.total = objInvoice.Total;

            //additional info
            objData.invoiceid = objInvoice.Invoice_ID;
            objData.datepaid = objInvoice.DatePaid;
            objData.balance = objInvoice.Balance;
            objData.orderid = objInvoice.Order_ID;

            //charges
            objData.charges = {
                tax: 0,
                other: 0,
                shipping: 0
            };

            arrInvoiceData.push({ ordObj: objData });
        }
        log.debug('Invoice Data', arrInvoiceData);
        return arrInvoiceData;
    }

    function formatOrderJson(responseBody, arrInvoiceData) {
        if (!responseBody) {
            return;
        }

        if (!vc2_util.isEmpty(responseBody.Queryable)) {
            responseBody = responseBody.Queryable;
        } else if (!vc2_util.isEmpty(responseBody.value)) {
            responseBody = responseBody.value;
        }

        var arrData = [];
        if (Array.isArray(responseBody)) {
            for (var i = 0; i < responseBody.length; i++) {
                var objOrder = responseBody[i];

                /*
    	        //get order ID from order response
    	        var orderId = objOrder.Order_ID;

    	        //find the object from invoice data with the same order id from order response
    	        var arrItem = arrInvoiceData.filter(function(objData) {
                    if(objData.ordObj!== undefined){
                        return (objData.ordObj.orderid === orderId);
                    }
                });

    	        if(vc2_util.isEmpty(arrItem) || arrItem.length<=0){continue;}

    	        var objInvoiceData = arrItem[0];

    	        //set lines key for line item
    	        objInvoiceData.ordObj.lines = [];

    	       	//get order lines from order response
    	       	var arrDetails = objOrder.Details;
    	       	for(var d=0;d<arrDetails.length; d++){

    	       		//get line items
    	       		var arrItems = arrDetails[d].LineItems;
    	       		for(var n=0; n<arrItems.length; n++){

    	       			//add data to invoice object
    	       			objInvoiceData.ordObj.lines.push({
    	       				ITEMNO:arrItems[n].Item,
    	       				PRICE:arrItems[n].Price,
    	       				QUANTITY:arrItems[n].Quantity,
    	       				DESCRIPTION:arrItems[n].Description,
    	       			});
    	       		}
    	       	}
    			
    			arrData.push({ordObj: objInvoiceData.ordObj});
    			*/
                getItemArray(arrData, arrInvoiceData, objOrder);
            }
        } else {
            getItemArray(arrData, arrInvoiceData, responseBody);
        }
        return arrData;
    }

    function getItemArray(arrData, arrInvoiceData, objOrder) {
        //get order ID from order response
        var orderId = objOrder.Order_ID;

        //find the object from invoice data with the same order id from order response
        var arrItem = arrInvoiceData.filter(function (objData) {
            if (objData.ordObj !== undefined) {
                return objData.ordObj.orderid === orderId;
            }
        });

        if (vc2_util.isEmpty(arrItem) || arrItem.length <= 0) {
            return;
        }

        var objInvoiceData = arrItem[0];

        //set lines key for line item
        objInvoiceData.ordObj.lines = [];
        objInvoiceData.ordObj.po = objOrder.CustomerPO;

        //get order lines from order response
        var arrDetails = objOrder.Details;
        for (var d = 0; d < arrDetails.length; d++) {
            //get line items
            var arrItems = arrDetails[d].LineItems;
            for (var n = 0; n < arrItems.length; n++) {
                //add data to invoice object
                objInvoiceData.ordObj.lines.push({
                    ITEMNO: arrItems[n].Item,
                    PRICE: arrItems[n].Price,
                    QUANTITY: arrItems[n].Quantity,
                    DESCRIPTION: arrItems[n].Description
                });
            }
        }

        arrData.push({
            ordObj: objInvoiceData.ordObj,
            xmlStr: JSON.stringify(objOrder)
        });
    }

    function getOrderID(responseBody) {
        if (!responseBody) {
            return;
        }

        if (!vc2_util.isEmpty(responseBody.Queryable)) {
            responseBody = responseBody.Queryable;
        } else if (!vc2_util.isEmpty(responseBody.value)) {
            responseBody = responseBody.value;
        }

        if (Array.isArray(responseBody)) {
            for (var i = 0; i < responseBody.length; i++) {
                ORDER_ID = responseBody[i].Order_ID;
            }
        } else {
            ORDER_ID = responseBody.Order_ID;
        }
        log.debug('getOrderID | ORDER_ID', ORDER_ID);
    }

    function getToken(config) {
        var logTitle = [LogTitle, 'getToken'].join('::');

        var objHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        var objBody = {
            grant_type: 'client_credentials',
            client_id: config.user_id,
            client_secret: config.user_pass,
            audience: config.scope
        };

        var tokenReq = vc2_util.sendRequest({
            header: logTitle,
            method: 'post',
            recordId: TransId,
            doRetry: true,
            maxRetry: 3,
            query: {
                url: config.token_url,
                body: vc2_util.convertToQuery(objBody),
                headers: objHeaders
            }
        });

        vc2_util.handleJSONResponse(tokenReq);

        var tokenResp = tokenReq.PARSED_RESPONSE;
        if (!tokenResp || !tokenResp.access_token) throw 'Unable to generate token';

        return 'Bearer ' + tokenResp.access_token;
    }

    function getTokenCache(config) {
        var token = vc2_util.getNSCache({ key: 'VC_BC_CARAHSOFT_TOKEN' });
        if (vc2_util.isEmpty(token)) token = getToken(config);

        if (!vc2_util.isEmpty(token)) {
            vc2_util.setNSCache({
                key: 'VC_BC_CARAHSOFT_TOKEN',
                cacheTTL: 300,
                value: token
            });
        }
        return token;
    }

    return EntryPoint;
});
