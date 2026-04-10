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
 * Script Name: VC Services | D&H API
 * @author brianf@nscatalyst.com
 * @description Vendor connector library for D&H services (order and invoice XML via SFTP/API).
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-08   brianf                Refactored multi-order ORDERSTATUS processing; hardened shipped/invoiced and package null-handling; added option guards and explicit Endpoint flow.
 * 2026-03-07   brianf                Ported multi-order ORDERSTATUS processing; fixed shipped-date handling and quantity/date parsing.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils'),
        vc2_constant = require('../../CTC_VC2_Constants');

    var ns_xml = require('N/xml');
    var LogTitle = 'WS:D&H';

    var CURRENT = {},
        DATE_FIELDS = vc2_constant.DATE_FIELDS;

    var Helper = {
        getNodeValue: function (node, xpath) {
            var logTitle = [LogTitle, 'getNodeValue'].join('::'),
                returnValue;

            try {
                var nodeValue = vc2_util.getNodeTextContent(
                    ns_xml.XPath.select({
                        node: node,
                        xpath: xpath
                    }).shift()
                );
                if (!nodeValue) throw 'Empty value';
                returnValue = nodeValue;
            } catch (error) {
                returnValue = false;
            }

            return returnValue;
        }
    };

    var LibDnH = {
        SkippedStatus: ['CANCELLED', 'CANCELED', 'DELETED'],
        ShippedStatus: ['SHIPPED', 'INVOICED'],
        InvoicedStatus: ['INVOICED'],

        initialize: function (option) {
            option = option || {};

            var logTitle = [LogTitle, 'initialize'].join('::');

            CURRENT.recordId = option.poId || option.recordId || CURRENT.recordId;
            CURRENT.recordNum = option.poNum || option.transactionNum || CURRENT.recordNum;
            CURRENT.orderConfig = option.vendorConfig || option.orderConfig || CURRENT.orderConfig;

            vc2_util.LogPrefix = '[purchaseorder:' + (CURRENT.recordId || CURRENT.recordNum) + '] ';
            if (!CURRENT.orderConfig) throw 'Missing vendor configuration!';

            return true;
        },

        processOrderStatus: function (option) {
            var logTitle = [LogTitle, 'processOrderStatus'].join('::'),
                returnValue = [];
            option = option || {};

            try {
                var orderStatusNode = option.node;
                if (!orderStatusNode) throw 'Missing ORDERSTATUS node';

                var orderNum = Helper.getNodeValue(orderStatusNode, 'ORDERNUM') || 'NA';

                var pkgNodes = ns_xml.XPath.select({ node: orderStatusNode, xpath: 'PACKAGE' });
                var packagesList = LibDnH.processPackages({ nodes: pkgNodes, orderNum: orderNum });
                CURRENT.PackagesList = CURRENT.PackagesList || {};
                if (packagesList) util.extend(CURRENT.PackagesList, packagesList);

                var detailItemNodes = ns_xml.XPath.select({
                    node: orderStatusNode,
                    xpath: 'ORDERDETAIL/DETAILITEM'
                });
                if (!util.isArray(detailItemNodes) || vc2_util.isEmpty(detailItemNodes))
                    return returnValue;

                for (var i = 0, j = detailItemNodes.length; i < j; i++) {
                    var itemNode = detailItemNodes[i];
                    var itemObj = LibDnH.processItem({ node: itemNode, parent: orderStatusNode });

                    DATE_FIELDS.forEach(function (dateField) {
                        if (!itemObj[dateField] || itemObj[dateField] == 'NA') return;

                        itemObj[dateField] = vc2_util.parseToVCDate(itemObj[dateField], 'MM/DD/YY');
                    });

                    returnValue.push(itemObj);
                }
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        },

        getOrderStatus: function (option) {
            var logTitle = [LogTitle, 'getOrderStatus'].join('::'),
                returnValue = [];
            option = option || {};

            try {
                var reqOrderStatus = vc2_util.sendRequest({
                    header: [LogTitle, 'Order Status'].join(' : '),
                    recordId: CURRENT.recordId,
                    method: 'post',
                    isXML: true,
                    query: {
                        url: CURRENT.orderConfig.endPoint,
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'Content-Length': 'length'
                        },
                        body:
                            '<XMLFORMPOST>' +
                            '<REQUEST>orderStatus</REQUEST>' +
                            '<LOGIN>' +
                            ('<USERID>' + CURRENT.orderConfig.user + '</USERID>') +
                            ('<PASSWORD>' + CURRENT.orderConfig.password + '</PASSWORD>') +
                            '</LOGIN>' +
                            '<STATUSREQUEST>' +
                            ('<PONUM>' + CURRENT.recordNum + '</PONUM>') +
                            '</STATUSREQUEST>' +
                            '</XMLFORMPOST>'
                    }
                });
                vc2_util.log(logTitle, 'reqOrderStatus: ', reqOrderStatus);
                if (reqOrderStatus.isError) throw reqOrderStatus.errorMsg;

                vc2_util.handleXMLResponse(reqOrderStatus);

                if (reqOrderStatus.isError) throw reqOrderStatus.errorMsg;
                var respOrderStatus = reqOrderStatus.RESPONSE.body;
                if (!respOrderStatus) throw 'Unable to fetch server response';

                returnValue = respOrderStatus;
            } catch (error) {
                throw error;
            }

            return returnValue;
        },

        getItemInquiry: function (option) {
            var logTitle = [LogTitle, 'getItemInquiry'].join('::'),
                returnValue = [];
            option = option || {};

            try {
                var reqItemQuery = vc2_util.sendRequest({
                    header: [LogTitle, 'ItemInquirey-DH'].join(' : '),
                    method: 'post',
                    isXML: true,
                    query: {
                        url: CURRENT.orderConfig.endPoint,
                        headers: {
                            'Content-Type': 'text/xml; charset=utf-8',
                            'Content-Length': 'length'
                        },
                        body:
                            '<XMLFORMPOST>' +
                            '<REQUEST>itemInquiry</REQUEST>' +
                            '<LOGIN>' +
                            ('<USERID>' + CURRENT.orderConfig.user + '</USERID>') +
                            ('<PASSWORD>' + CURRENT.orderConfig.password + '</PASSWORD>') +
                            '</LOGIN>' +
                            ('<PARTNUM>' + option.itemName + '</PARTNUM>') +
                            ('<LOOKUPTYPE>' + option.lookupType + '</LOOKUPTYPE>') +
                            '</XMLFORMPOST>'
                    }
                });

                vc2_util.log(logTitle, 'reqItemQuery: ', reqItemQuery);
                if (reqItemQuery.isError) throw reqItemQuery.errorMsg;

                vc2_util.handleXMLResponse(reqItemQuery);

                if (reqItemQuery.isError) throw reqItemQuery.errorMsg;
                var respItemQuery = reqItemQuery.RESPONSE.body;
                if (!respItemQuery) throw 'Unable to fetch server response';

                returnValue = respItemQuery;
            } catch (error) {
                throw error;
            }

            return returnValue;
        },

        processItem: function (option) {
            var logTitle = [LogTitle, 'processItem'].join('::');

            option = option || {};

            var itemNode = option.node || option.itemNode,
                parentNode = option.parent;
            var itemObj = {};
            try {
                itemObj = {
                    order_num: Helper.getNodeValue(parentNode, 'ORDERNUM') || 'NA',
                    order_status: Helper.getNodeValue(parentNode, 'MESSAGE') || 'NA',

                    order_date: Helper.getNodeValue(parentNode, 'DATE') || 'NA',
                    ship_date: 'NA',
                    order_eta: Helper.getNodeValue(itemNode, 'ETA') || 'NA',
                    deliv_eta: 'NA',
                    deliv_date: 'NA',
                    prom_date: 'NA',

                    item_num: Helper.getNodeValue(itemNode, 'ITEMNO') || 'NA',
                    item_num_alt: 'NA',
                    vendorSKU: 'NA',
                    item_sku: 'NA',

                    ship_qty: parseInt(Helper.getNodeValue(itemNode, 'QUANTITY') || 0, 10) || 0,
                    unitprice: vc2_util.parseFloat(Helper.getNodeValue(itemNode, 'PRICE') || ''),
                    line_price: vc2_util.parseFloat(Helper.getNodeValue(itemNode, 'PRICE') || ''),

                    line_num: 'NA',
                    line_status: 'NA',

                    carrier: 'NA',
                    tracking_num: 'NA',
                    serial_num: 'NA',

                    is_shipped: false
                };

                if (
                    !itemObj.order_status ||
                    itemObj.order_status == 'NA' ||
                    vc2_util.inArray(itemObj.order_status.toUpperCase(), LibDnH.SkippedStatus)
                )
                    throw 'Skipped Status - ' + itemObj.order_status;

                var itemPkgIndex = [itemObj.order_num, itemObj.item_num].join('::'),
                    itemPkgObj = CURRENT.PackagesList && CURRENT.PackagesList[itemPkgIndex];

                if (itemPkgObj) {
                    util.extend(itemObj, {
                        serial_num:
                            itemPkgObj.serials && !vc2_util.isEmpty(itemPkgObj.serials)
                                ? (function () {
                                      var serials = vc2_util.uniqueArray(itemPkgObj.serials);
                                      return serials.join(',');
                                  })()
                                : itemObj.serial_num,
                        carrier:
                            itemPkgObj.carriers && !vc2_util.isEmpty(itemPkgObj.carriers)
                                ? (function () {
                                      var carriers = vc2_util.uniqueArray(itemPkgObj.carriers);
                                      return carriers.join(',');
                                  })()
                                : itemObj.carrier,
                        tracking_num:
                            itemPkgObj.trackingNums && !vc2_util.isEmpty(itemPkgObj.trackingNums)
                                ? (function () {
                                      var trackingNums = vc2_util.uniqueArray(
                                          itemPkgObj.trackingNums
                                      );
                                      return trackingNums.join(',');
                                  })()
                                : itemObj.tracking_num,
                        ship_date:
                            itemPkgObj.dateshipped && !vc2_util.isEmpty(itemPkgObj.dateshipped)
                                ? (function () {
                                      var dateshipped = vc2_util.uniqueArray(
                                          itemPkgObj.dateshipped
                                      );
                                      return dateshipped.shift();
                                  })()
                                : itemObj.ship_date
                    });
                }

                var isShippedStatus = vc2_util.inArray(
                        itemObj.order_status.toUpperCase(),
                        LibDnH.ShippedStatus
                    ),
                    isInvoicedStatus = vc2_util.inArray(
                        itemObj.order_status.toUpperCase(),
                        LibDnH.InvoicedStatus
                    );

                vc2_util.log(logTitle, 'is shipped/invoiced: ', [
                    isShippedStatus,
                    isInvoicedStatus
                ]);

                if (!isShippedStatus && !isInvoicedStatus) {
                    util.extend(itemObj, {
                        ship_date: 'NA',
                        is_shipped: false
                    });
                } else {
                    util.extend(itemObj, {
                        is_shipped: true,
                        valid_shipped_status: isShippedStatus,
                        is_invoiced: isInvoicedStatus
                    });
                }
            } catch (err) {
                itemObj.SKIPPED = vc2_util.extractError(err);
                vc2_util.logError(logTitle, err);
            }

            return itemObj;
        },

        processPackages: function (option) {
            var logTitle = [LogTitle, 'processPackages'].join('::');

            option = option || {};

            var packagesNodes = option.nodes;
            if (!util.isArray(packagesNodes) || vc2_util.isEmpty(packagesNodes)) return false;

            var packagesList = {};

            for (var i = 0, j = packagesNodes.length; i < j; i++) {
                var pkgNode = packagesNodes[i],
                    shipItemNodes = ns_xml.XPath.select({ node: pkgNode, xpath: 'SHIPITEM' });

                var packageObj = {
                    orderNum:
                        option.orderNum || Helper.getNodeValue(pkgNode.parentNode, 'ORDERNUM'),
                    carrier: Helper.getNodeValue(pkgNode, 'CARRIER'),
                    service: Helper.getNodeValue(pkgNode, 'SERVICE'),
                    trackNum: Helper.getNodeValue(pkgNode, 'TRACKNUM'),
                    dateShipped: Helper.getNodeValue(pkgNode, 'DATESHIPPED'),
                    isShipped: Helper.getNodeValue(pkgNode, 'SHIPPED')
                };

                if (!util.isArray(shipItemNodes) || vc2_util.isEmpty(shipItemNodes)) continue;

                for (var ii = 0, jj = shipItemNodes.length; ii < jj; ii++) {
                    var shipItemNode = shipItemNodes[ii],
                        shipItemNo = Helper.getNodeValue(shipItemNode, 'SHIPITEMNO'),
                        shipSerialNo = Helper.getNodeValue(shipItemNode, 'SERIALNO');

                    var pkgIndex = [packageObj.orderNum, shipItemNo].join('::');

                    if (!packagesList[pkgIndex])
                        packagesList[pkgIndex] = {
                            carriers: [],
                            carrierServices: [],
                            serials: [],
                            trackingNums: [],
                            dateshipped: []
                        };

                    if (shipSerialNo) packagesList[pkgIndex].serials.push(shipSerialNo);

                    if (packageObj.carrier)
                        packagesList[pkgIndex].carriers.push(packageObj.carrier);

                    if (packageObj.service)
                        packagesList[pkgIndex].carrierServices.push(packageObj.service);

                    if (packageObj.trackNum)
                        packagesList[pkgIndex].trackingNums.push(packageObj.trackNum);

                    if (packageObj.dateShipped)
                        packagesList[pkgIndex].dateshipped.push(packageObj.dateShipped);
                }
            }

            return packagesList;
        }
    };

    var Endpoint = {
        processRequest: function (option) {
            var logTitle = [LogTitle, 'processRequest'].join('::'),
                returnValue = [];
            option = option || {};

            try {
                LibDnH.initialize(option);
                returnValue = LibDnH.getOrderStatus(option);
            } catch (error) {
                throw error;
            }

            return returnValue;
        },
        process: function (option) {
            var logTitle = [LogTitle, 'process'].join('::'),
                returnValue = {};
            option = option || {};

            try {
                LibDnH.initialize(option);
                var xmlResponse = Endpoint.processRequest(option),
                    xmlResponseStr = xmlResponse,
                    xmlDoc = ns_xml.Parser.fromString({ text: xmlResponse });

                if (!xmlDoc) throw 'Unable to parse XML';

                if (option.debugMode) {
                    if (!option.showLines) return xmlResponse;
                }

                var arrOrderStatusNodes = ns_xml.XPath.select({
                    node: xmlDoc,
                    xpath: '//ORDERSTATUS'
                });
                if (!util.isArray(arrOrderStatusNodes) || vc2_util.isEmpty(arrOrderStatusNodes))
                    throw 'XML: Missing Order Status nodes';

                CURRENT.PackagesList = {};

                var OrderList = {},
                    arrOrdersList = [],
                    itemArray = [];

                for (var i = 0, j = arrOrderStatusNodes.length; i < j; i++) {
                    var orderStatusNode = arrOrderStatusNodes[i];

                    var orderData = {
                        Status: Helper.getNodeValue(orderStatusNode, 'MESSAGE') || 'NA',
                        OrderNum: Helper.getNodeValue(orderStatusNode, 'PONUM') || 'NA',
                        VendorOrderNum: Helper.getNodeValue(orderStatusNode, 'ORDERNUM') || 'NA',
                        OrderDate: vc2_util.parseToVCDate(
                            Helper.getNodeValue(orderStatusNode, 'DATE') || 'NA',
                            'MM/DD/YY'
                        ),
                        Total: Helper.getNodeValue(orderStatusNode, 'INVTOTAL') || 'NA',
                        InvoiceNo: Helper.getNodeValue(orderStatusNode, 'INVOICE') || 'NA'
                    };

                    if (!OrderList[orderData.VendorOrderNum]) {
                        OrderList[orderData.VendorOrderNum] = orderData;
                        arrOrdersList.push(orderData);
                    }

                    var orderItems = LibDnH.processOrderStatus({ node: orderStatusNode });
                    itemArray = itemArray.concat(orderItems);
                }

                vc2_util.log(logTitle, 'itemArray: ', itemArray);

                util.extend(returnValue, {
                    Orders: arrOrdersList,
                    Lines: itemArray,
                    Source: xmlResponseStr
                });
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        },
        processItemInquiry: function (option) {
            var logTitle = [LogTitle, 'processItem'].join('::'),
                returnValue = {};
            option = option || {};

            try {
                LibDnH.initialize(option);

                var xmlResponse = LibDnH.getItemInquiry(option);
                if (!xmlResponse) throw 'No response from D&H';

                var xmlDoc = ns_xml.Parser.fromString({ text: xmlResponse });
                if (!xmlDoc) throw 'Unable to parse XML';

                var itemNode = ns_xml.XPath.select({ node: xmlDoc, xpath: '//ITEM' });
                if (!itemNode || itemNode.length < 1) throw 'No item details found';

                var itemObj = {
                    partNum: Helper.getNodeValue(itemNode[0], 'PARTNUM') || 'NA',
                    itemNum: Helper.getNodeValue(itemNode[0], 'VENDORITEMNO') || 'NA'
                };

                returnValue = itemObj;
            } catch (error) {
                vc2_util.logError(logTitle, error);
                returnValue = false;
            }

            return returnValue;
        }
    };

    return Endpoint;
});
