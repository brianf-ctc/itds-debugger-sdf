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
 * Script Name: VC Services | Ingram V1 (Cisco)
 * @author shawn.blackburn
 * @description Helper library for Ingram Micro V1 (Cisco) order status and PO tracking.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils'),
        vc2_constant = require('../../CTC_VC2_Constants');

    var LogTitle = 'WS:IngramAPI';

    var CURRENT = {
            TokenName: 'VC_INGRAM_TOKEN',
            CacheTTL: 43200 // 12 hrs cache
        },
        DATE_FIELDS = vc2_constant.DATE_FIELDS,
        ERROR_MSG = vc2_constant.ERRORMSG;

    var IngramOrders = {
            EndPoint: {},
            LIST: [],
            ORDERS: {},
            RESULT: {}
        },
        FLDS_TO_BKUP = [
            'order_num',
            'order_eta',
            'ship_date',
            'deliv_eta',
            'deliv_date',
            'prom_date'
        ];

    var LibIngramAPI = {
        ValidShippedStatus: [
            'SHIPPED',
            'INVOICED',
            'DELIVERED',
            'E-DELIVERED',
            'PARTIALLY DELIVERED',
            'PARTIALLY SHIPPED'
        ],
        ValidShippedLineStatus: ['SHIPPED', 'INVOICED', 'DELIVERED', 'E-DELIVERED', 'CLOSED'],
        SkippedStatus: ['CANCELED', 'CANCELLED'],
        generateToken: function () {
            var logTitle = [LogTitle, 'LibIngramAPI::generateToken'].join('::'),
                returnValue;

            try {
                var respToken = vc2_util.sendRequest({
                    header: [LogTitle, 'Generate Token'].join(' '),
                    method: 'post',
                    recordId: CURRENT.recordId,
                    query: {
                        url: CURRENT.orderConfig.accessEndPoint,
                        body: vc2_util.convertToQuery({
                            client_id: CURRENT.orderConfig.apiKey,
                            client_secret: CURRENT.orderConfig.apiSecret,
                            grant_type: 'client_credentials'
                        }),
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    }
                });
                vc2_util.handleJSONResponse(respToken);

                if (!respToken.PARSED_RESPONSE) throw 'Unable to generate token';
                returnValue = respToken.PARSED_RESPONSE.access_token;
            } catch (error) {
                throw error;
            }

            return returnValue;
        },
        orderSearch: function (option) {
            var logTitle = [LogTitle, 'LibIngramAPI::orderSearch'].join('::'),
                returnValue;

            try {
                IngramOrders.EndPoint.search = [
                    LibIngramAPI.EndPointV6,
                    '/search?customerOrderNumber=',
                    CURRENT.recordNum
                ].join('');

                var respOrderSearch = vc2_util.sendRequest({
                    header: [LogTitle, 'Order Search'].join(' '),
                    query: {
                        url: IngramOrders.EndPoint.search,
                        headers: {
                            Authorization: 'Bearer ' + CURRENT.accessToken,
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'IM-CustomerNumber': CURRENT.orderConfig.customerNo,
                            'IM-CountryCode': CURRENT.orderConfig.country || 'US', // default to US
                            'IM-CustomerOrderNumber': CURRENT.recordNum,
                            'IM-CorrelationID': [CURRENT.recordNum, CURRENT.recordId].join('-'),
                            'IM-SenderID': 'NS_Catalyst'
                        }
                    },
                    recordId: CURRENT.recordId
                });

                vc2_util.handleJSONResponse(respOrderSearch);
                if (!respOrderSearch.PARSED_RESPONSE) throw 'Unable to fetch server response';

                var parsedOrders = respOrderSearch.PARSED_RESPONSE.orders;
                if (vc2_util.isEmpty(parsedOrders)) throw ERROR_MSG.ORDER_NOT_FOUND;

                returnValue = parsedOrders;
            } catch (error) {
                throw error;
            }

            return returnValue;
        },
        orderDetails: function (option) {
            var logTitle = [LogTitle, 'LibIngramAPI::orderDetails'].join('::'),
                returnValue;

            var ingramOrderNum = option.orderNum,
                endpointUrl = option.endpointUrl || CURRENT.orderConfig.endPoint;

            try {
                IngramOrders.EndPoint.orderDetails = endpointUrl;

                var respOrderDetails = vc2_util.sendRequest({
                    header: [LogTitle, 'Order Details'].join(' '),
                    query: {
                        url: [IngramOrders.EndPoint.orderDetails, ingramOrderNum].join('/'),
                        headers: {
                            Authorization: 'Bearer ' + CURRENT.accessToken,
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            'IM-CustomerNumber': CURRENT.orderConfig.customerNo,
                            'IM-CountryCode': CURRENT.orderConfig.country,
                            'IM-CorrelationID': [CURRENT.recordNum, CURRENT.recordId].join('-'),
                            'IM-SenderID': 'NS_Catalyst'
                        }
                    },
                    recordId: CURRENT.recordId
                });
                if (respOrderDetails.isError)
                    if (!respOrderDetails.PARSED_RESPONSE) throw respOrderDetails.errorMsg;

                // vc2_util.log(logTitle, '>> response: ', respOrderDetails);

                vc2_util.handleJSONResponse(respOrderDetails);
                if (!respOrderDetails.PARSED_RESPONSE) throw 'Unable to fetch server response';

                // vc2_util.log(logTitle, '>> parsed response: ', respOrderDetails.PARSED_RESPONSE);

                returnValue = respOrderDetails.PARSED_RESPONSE;
            } catch (error) {
                return vc2_util.extractError(error);
                // throw error;
            }

            return returnValue;
        }
    };

    var Helper = {
        getValidValue: function (value) {
            return !vc2_util.isEmpty(value) && value !== 'NA' ? value : null;
        }
    };

    var LibOrderStatus = {
        initialize: function (option) {
            var logTitle = [LogTitle, 'LibOrderStatus::initialize'].join('::'),
                returnValue;

            CURRENT.recordId = option.poId || option.recordId;
            CURRENT.recordNum = option.poNum || option.transactionNum;
            CURRENT.orderConfig = option.orderConfig;

            if (!CURRENT.orderConfig) throw 'Missing vendor configuration';

            // Detect the endpoints
            var endPoint = CURRENT.orderConfig.endPoint;
            if (!endPoint) throw 'Missing end point configuration';

            if (endPoint.match(/\/v6.1\//gi)) {
                CURRENT.isV61 = true;
                LibIngramAPI.EndPointV61 = endPoint;
                LibIngramAPI.EndPointV6 = endPoint.replace('/v6.1/', '/v6/');
            } else {
                CURRENT.isV61 = false;
                LibIngramAPI.EndPointV6 = endPoint;
                LibIngramAPI.EndPointV61 = endPoint.replace('/v6/', '/v6.1/');
            }

            CURRENT.hasV61Errors = false;

            // report if v6.1 is not set
            if (!CURRENT.isV61) throw 'Set the Webservice Endpoint to V6.1';

            vc2_util.LogPrefix = '[purchaseorder:' + (CURRENT.recordId || CURRENT.recordNum) + '] ';

            return returnValue;
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

            if (vc2_util.isEmpty(accessToken)) accessToken = LibIngramAPI.generateToken();

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
        extractValidOrders: function (orderResults) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractValidOrders'].join('::'); // build contextual log title

            if (!util.isArray(orderResults) || vc2_util.isEmpty(orderResults)) return false; // guard empty/invalid input
            var arrValidOrders = []; // accumulator for flattened valid (sub)orders

            (orderResults || []).forEach(function (orderResult) {
                // iterate each top-level order result
                var orderData = {
                    // base template copied per sub-order
                    VendorOrderNum: orderResult.ingramOrderNumber, // placeholder; replaced with subOrderNumber below
                    IngramOrderNum: orderResult.ingramOrderNumber, // parent ingram order number
                    OrderDate: vc2_util.parseToVCDateStandard(orderResult.ingramOrderDate), // normalized order date
                    OrderNum: orderResult.customerOrderNumber, // customer PO/reference
                    Status: orderResult.orderStatus, // parent status
                    Total: orderResult.orderTotal // parent total amount
                };

                try {
                    if (!orderResult.orderStatus) throw 'MISSING OrderStatus'; // ensure status present

                    // Skip list logic retained (commented) for potential future filtering of statuses
                    // if (vc2_util.inArray(orderResult.orderStatus, LibIngramAPI.SkippedStatus))
                    //     throw 'SKIPPED OrderStatus - ' + orderResult.orderStatus;

                    if (vc2_util.isEmpty(orderResult.subOrders)) throw 'MISSING subOrders'; // require sub orders array

                    orderResult.subOrders.forEach(function (subOrderData) {
                        // expand each sub order
                        var subOrderNumber = subOrderData.subOrderNumber; // child identifier
                        // Assemble child record inheriting base data and overriding child-specific fields
                        arrValidOrders.push(
                            vc2_util.extend(vc2_util.clone(orderData), {
                                VendorOrderNum: subOrderNumber, // child vendor order number
                                Total: subOrderData.subOrderTotal, // child total
                                Status: subOrderData.subOrderStatus || orderData.Status // prefer child status
                            })
                        );
                    });
                } catch (error) {
                    // Log skipped/errored parent order with reason and raw data
                    vc2_util.log(logTitle, '*** SKIPPED ORDER: ', [
                        vc2_util.extractError(error),
                        orderResult
                    ]);
                    orderData.ERROR = vc2_util.extractError(error); // attach error for possible diagnostics
                }
            });

            return arrValidOrders; // flattened list of all valid sub-orders
        },
        extractShipmentDetails: function (shipmentDetails) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractShipmentDetails'].join('::');

            if (vc2_util.isEmpty(shipmentDetails)) return false;

            var shipData = {
                quantity: 0,
                serialNos: [],
                trackingNos: []
            };

            for (var i = 0, j = shipmentDetails.length; i < j; i++) {
                var shipmentDetail = shipmentDetails[i];

                util.extend(shipData, {
                    quantity: shipData.quantity + parseFloat(shipmentDetail.quantity),
                    order_date: vc2_util.parseToStandardDate(shipmentDetail.invoiceDate) || 'NA',
                    ship_date: vc2_util.parseToStandardDate(shipmentDetail.shippedDate) || 'NA',
                    deliv_eta: vc2_util.parseToStandardDate(shipmentDetail.estimatedDeliveryDate) || 'NA',
                    order_eta: vc2_util.parseToStandardDate(shipmentDetail.estimatedShipDate) || 'NA'
                });

                if (vc2_util.isEmpty(shipmentDetail.carrierDetails)) continue;

                var carrierDetails = shipmentDetail.carrierDetails;
                if (vc2_util.isEmpty(carrierDetails)) continue;
                if (!util.isArray(carrierDetails)) carrierDetails = [carrierDetails];

                var carrierCodes = [],
                    carrierNames = [];

                carrierDetails.forEach(function (carrierDetail) {
                    if (!vc2_util.inArray(carrierDetail.carrierCode, carrierCodes))
                        carrierCodes.push(carrierDetail.carrierCode);
                    if (!vc2_util.inArray(carrierDetail.carrierName, carrierNames))
                        carrierNames.push(carrierDetail.carrierName);

                    if (!vc2_util.isEmpty(carrierDetail.trackingDetails)) {
                        var serialNos = LibOrderStatus.extractSerialNos(
                                carrierDetail.trackingDetails
                            ),
                            trackingNos = LibOrderStatus.extractTrackingNos(
                                carrierDetail.trackingDetails
                            );

                        shipData.serialNos = shipData.serialNos.concat(serialNos);
                        shipData.trackingNos = shipData.trackingNos.concat(trackingNos);
                    }
                });

                shipData.carrier =
                    carrierNames.length > 1 ? carrierNames.join(',') : carrierNames[0];
            }

            shipData.serialNos = vc2_util.uniqueArray(shipData.serialNos);
            shipData.trackingNos = vc2_util.uniqueArray(shipData.trackingNos);

            // vc2_util.log(logTitle, '// shipment details: ', shipData);

            return shipData;
        },
        extractTrackingNos: function (trackingDetails) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractTrackingNos'].join('::');

            var trackingNos = [];

            for (var i = 0, j = trackingDetails.length; i < j; i++) {
                if (trackingDetails[i].trackingNumber) {
                    trackingNos = trackingNos.concat(
                        trackingDetails[i].trackingNumber.split(/[\W]+/g)
                    );
                }
            }

            return trackingNos;
        },
        extractSerialNos: function (trackingDetails) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractSerialNos'].join('::');

            var serialNos = [];

            for (var i = 0, j = trackingDetails.length; i < j; i++) {
                var serialNums =
                    trackingDetails[i].serialNumbers ||
                    trackingDetails[i].SerialNumbers ||
                    trackingDetails[i].serialnumbers;

                if (serialNums) {
                    serialNums.forEach(function (serialNum) {
                        serialNos.push(serialNum.serialNumber);
                        return true;
                    });
                }
            }

            return serialNos;
        },
        extractEstimatedDates: function (estDateDetails) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractEstimatedDates'].join('::');
            // (1) Guard: return undefined if empty (callers treat falsy as absent)
            if (vc2_util.isEmpty(estDateDetails)) return;
            // (2) Initialize container
            var estimatedDates = {};
            // (3) Iterate entries to merge fields
            for (var i = 0, j = estDateDetails.length; i < j; i++) {
                // Extract ship and delivery nodes (they may be missing)
                var ship = estDateDetails[i].ship,
                    delivery = estDateDetails[i].delivery;
                // (4) Merge ship node (later entries override earlier)
                if (ship)
                    util.extend(estimatedDates, {
                        shipDate: ship.shipDate,
                        shipDesc: ship.shipDescription,
                        shipSource: ship.shipSource
                    });
                // (5) Merge delivery node (simple override semantics)
                if (delivery) util.extend(estimatedDates, { deliveryDate: delivery.deliveryDate });
            }
            // (6) Return consolidated result
            return estimatedDates;
        },
        /*
         Build a normalized representation (lineData) from a raw Ingram line + its order context.
         Source pieces merged:
           - orderDetails (shared header)
           - ingramLine (line-level specifics)
           - shipmentDetails / estimatedDates (optional enrichment)

         lineData sample BEFORE hierarchy / inheritance:
         {
           order_num: "SUB-001",          // initial sub order reference (may be replaced later)
           subOrderNum: "SUB-001",        // raw sub order number
           order_date: "2024-06-01",      // header order date
           order_status: "SHIPPED",       // header order status
           line_num: "1001",              // customer or ingram line number
           vendor_lineno: "1.1",          // vendor dotted hierarchy identifier
           line_status: "SHIPPED",        // specific line status
           item_num: "VENDOR-SKU",        // vendor part number
           item_num_alt: "INGRAM-SKU",    // ingram part number
           vendorSKU: "INGRAM-SKU",       // duplicate alias kept for downstream compatibility
           ship_qty: 5,                    // confirmed > ordered fallback
           ship_date: "NA",               // populated from shipment details if available
           order_eta: "NA",               // promised or shipment/estimated
           deliv_eta: "NA",               // estimated delivery date
           deliv_date: "NA",              // actual delivery date (if ever supplied)
           prom_date: "NA",               // promised date (if supplied)
           order_data: "{...}",           // serialized additional attributes (optional)
           order_type: "DIRECT",          // order type from header
           ordernum_ingram: "ING-12345",  // ingram order number
           ingram_subordernum: "SUB-001", // sub order number repeated
           ingram_lineno: "1001",         // ingram raw line number
           carrier: "NA",                 // enrichment after shipment processing
           serial_num: "NA",              // comma separated serials (optional)
           tracking_num: "NA"             // comma separated tracking numbers (optional)
         }
         Notes:
           * Fields default to 'NA' (string) to simplify downstream sentinel checks.
           * Hierarchy step later may override: order_num, *_eta, deliv_date, prom_date.
        */
        extractLineData: function (ingramLine, orderDetails) {
            var logTitle = [LogTitle, 'LibOrderStatus::extractLineData'].join('::');

            // Build base fields + immediate fallbacks
            var lineData = {
                order_num: ingramLine.subOrderNumber || 'NA',
                subOrderNum: ingramLine.subOrderNumber || 'NA',
                order_date: vc2_util.parseToStandardDate(orderDetails.ingramOrderDate) || 'NA',
                order_status: orderDetails.orderStatus || 'NA',
                line_num: ingramLine.customerLineNumber || ingramLine.ingramOrderLineNumber || 'NA',
                vendor_lineno: ingramLine.vendorSalesOrderLineNumber || 'NA',
                line_status: ingramLine.lineStatus || 'NA',
                item_num: ingramLine.vendorPartNumber || 'NA',
                item_num_alt: ingramLine.ingramPartNumber || 'NA',
                vendorSKU: ingramLine.ingramPartNumber || 'NA',
                ship_qty:
                    !vc2_util.isEmpty(ingramLine.quantityConfirmed) && ingramLine.quantityConfirmed
                        ? ingramLine.quantityConfirmed
                        : !vc2_util.isEmpty(ingramLine.quantityOrdered) &&
                            ingramLine.quantityOrdered
                          ? ingramLine.quantityOrdered
                          : 'NA',
                ship_date: 'NA',
                order_eta: 'NA',
                deliv_eta: 'NA',
                deliv_date: 'NA',
                prom_date: 'NA',
                order_data: 'NA',
                order_type: orderDetails.orderType || 'NA',
                ordernum_ingram: orderDetails.ingramOrderNumber || 'NA',
                ingram_subordernum: ingramLine.subOrderNumber || 'NA',
                ingram_lineno: ingramLine.ingramOrderLineNumber || 'NA'
            };
            lineData.line_no = vc2_util.parseFloat(lineData.line_num);

            if (lineData.vendor_lineno && lineData.vendor_lineno !== 'NA') {
                lineData.line_num =
                    lineData.line_num && lineData.line_num !== 'NA'
                        ? [lineData.vendor_lineno, ' [' + lineData.line_num + ']'].join('')
                        : lineData.vendor_lineno;
            }

            // Enrich with shipment aggregates (quantity, carrier, serials, tracking, selected dates)
            var shipment = LibOrderStatus.extractShipmentDetails(ingramLine.shipmentDetails);
            util.extend(lineData, {
                ship_qty: !vc2_util.isEmpty(shipment.quantity)
                    ? shipment.quantity
                    : lineData.ship_qty,
                order_date: shipment.order_date || 'NA',
                ship_date: shipment.ship_date || 'NA',
                order_eta:
                    ingramLine.promisedDeliveryDate ||
                    shipment.order_eta ||
                    shipment.order_eta_ship ||
                    'NA',

                deliv_eta: shipment.deliv_eta || 'NA',

                carrier: shipment.carrier || 'NA',
                serial_num:
                    shipment.serialNos && shipment.serialNos.length
                        ? shipment.serialNos.join(',')
                        : 'NA',
                tracking_num:
                    shipment.trackingNos && shipment.trackingNos.length
                        ? shipment.trackingNos.join(',')
                        : 'NA'
            });

            // Apply estimated date overlays (if present) without discarding prior successful values
            var estimatedDates = this.extractEstimatedDates(ingramLine.estimatedDates);
            if (!vc2_util.isEmpty(estimatedDates)) {
                util.extend(lineData, {
                    order_eta: estimatedDates.shipDate || lineData.order_eta,
                    deliv_eta: estimatedDates.deliveryDate,
                    eta_ship_desc: estimatedDates.shipDescription,
                    eta_ship_source: estimatedDates.shipSource
                });
            }
            // Capture selected optional raw nodes (serviceContractInfo, additionalAttributes)
            var addLineData = {};
            ['serviceContractInfo', 'additionalAttributes'].forEach(function (nodeData) {
                if (ingramLine[nodeData] && !vc2_util.isEmpty(ingramLine[nodeData])) {
                    addLineData[nodeData] = ingramLine[nodeData];
                }
                return true;
            });

            if (!vc2_util.isEmpty(addLineData)) {
                lineData.order_data = JSON.stringify(addLineData);
            }

            return lineData;
        },

        /*
         Purpose: Build hierarchical map of vendor line numbers grouped by Ingram order number.
         Input sample (orderLines):
         [
           { ordernum_ingram: "12-345", ordernum_main: "PO123", vendor_lineno: "1.1" },
           { ordernum_ingram: "12-345", vendor_lineno: "1.1.1" },
           { ordernum_ingram: "12-345", vendor_lineno: "2.1" },
           { ordernum_ingram: "98-765", vendor_lineno: "1.1" }
         ]
         Output structure:
         {
           "12-345": {
             "1.1": { "1.1.1": {} },
             "2.1": {}
           },
           "98-765": { "1.1": {} }
         }
         Flow:
           1. Collect & de-duplicate vendor line numbers per order.
           2. Sort vendor line numbers lexically (preserves dotted hierarchy ordering).
           3. Build nested object: root is first two segments (e.g., 1.2); deeper segments become chained keys.
        */
        buildVendorLineHierarchy: function (orderLines) {
            var logTitle = [LogTitle, 'LibOrderStatus::buildVendorLineHierarchy'].join('::'),
                returnValue;

            // Validate input
            if (!util.isArray(orderLines) || vc2_util.isEmpty(orderLines)) {
                vc2_util.log(logTitle, 'No order lines to process');
                return false;
            }

            // Accumulator: { <ingramOrderNum>: [ '1.1', '1.1.1', ... ] }
            var orderNumVendorLineNos = {},
                // Final hierarchical map: { <ingramOrderNum>: { '1.1': { '1.1.1': {} } } }
                orderNumVendorLineNosGrouped = {};

            // (1) Collect unique vendor line numbers per order
            orderLines.forEach(function (orderLine) {
                if (!Helper.getValidValue(orderLine.vendor_lineno)) return;

                var orderNum =
                        Helper.getValidValue(orderLine.ordernum_ingram) ||
                        Helper.getValidValue(orderLine.ordernum_main),
                    vendorLineNo = orderLine.vendor_lineno.toString().trim();

                var vendorLineNos = orderNumVendorLineNos[orderNum] || [];

                if (!vc2_util.inArray(vendorLineNo, vendorLineNos))
                    vendorLineNos.push(vendorLineNo);

                orderNumVendorLineNos[orderNum] = vendorLineNos;
            });

            // (2) For each order, sort and construct hierarchy
            for (var orderNum in orderNumVendorLineNos) {
                orderNumVendorLineNos[orderNum].sort(function (a, b) {
                    return a.localeCompare(b);
                });

                var groupedVendorLines = {};

                // (3) Build nested structure for each vendor line no
                orderNumVendorLineNos[orderNum].forEach(function (vendorLineNo) {
                    var parsed = vendorLineNo.split(/\./g);
                    var topLevel = [parsed[0], parsed[1]].join('.');
                    if (!groupedVendorLines[topLevel]) groupedVendorLines[topLevel] = {};

                    // Start nesting at root (first two segments)
                    var currentGroup = groupedVendorLines[topLevel],
                        currentLevel = topLevel;
                    for (var i = 2; i < parsed.length; i++) {
                        var level = parsed[i];
                        if (!level) break; // stop on empty segment
                        currentLevel += '.' + level;
                        if (!parseInt(level)) continue; // ignore non-numeric (defensive)
                        if (!currentGroup[currentLevel]) currentGroup[currentLevel] = {};
                        currentGroup = currentGroup[currentLevel];
                    }
                });
                orderNumVendorLineNosGrouped[orderNum] = groupedVendorLines;
            }

            returnValue = orderNumVendorLineNosGrouped;
            return returnValue;
        },

        /*
         Walk a hierarchical vendor line number map and produce a flattened list
         that preserves parent/child relationships and embeds child 'parts' arrays on parents.

         Input:
           option.sortedVendorLineNos (object) - hierarchical map produced by buildVendorLineHierarchy.
           Example sortedVendorLineNos (single order scope):
           {
             "1.1": { "1.1.1": {}, "1.1.2": {} },
             "1.2": {},
             "2.5": { "2.5.1": { "2.5.1.1": {} } }
           }

         Output (flattened array - order reflects depth-first traversal):
           [
             { vendorLineNo: '1.1', parts: [ { vendorLineNo: '1.1.1', parent: '1.1' }, { vendorLineNo: '1.1.2', parent: '1.1' } ] },
             { vendorLineNo: '1.1.1', parent: '1.1' },
             { vendorLineNo: '1.1.2', parent: '1.1' },
             { vendorLineNo: '1.2' },
             { vendorLineNo: '2.5', parts: [ { vendorLineNo: '2.5.1', parent: '2.5' } ] },
             { vendorLineNo: '2.5.1', parent: '2.5', parts: [ { vendorLineNo: '2.5.1.1', parent: '2.5.1' } ] },
             { vendorLineNo: '2.5.1.1', parent: '2.5.1' }
           ]
        */
        flattenVendorLineMap: function (option) {
            var logTitle = [LogTitle, 'LibIngramAPI::flattenVendorLineMap'].join('::'),
                returnValue; // kept for interface parity (unused)

            // Extract inputs (orderLines unused except for validation parity)
            var orderLines = option.orderLines || [],
                sortedVendorLineNos = option.sortedVendorLineNos || [];

            // (1) Validate input
            if (!util.isArray(orderLines) || vc2_util.isEmpty(orderLines)) {
                vc2_util.log(logTitle, 'No order lines to process');
                return orderLines;
            }

            // (2) Prepare accumulator for flattened traversal
            var arrGroupedLineNos = [];

            // (2a) Recursive depth-first walker
            // Recursive depth-first walker to flatten hierarchy while keeping parent/parts relationships
            var fnGroupLevel = function (groupedLevel, parentLevel, topLevel) {
                // Local collection of this level's immediate child node descriptors (returned to caller)
                var parts = [];

                // Iterate each vendor line number key at the current hierarchical depth
                for (var vendorLineNo in groupedLevel) {
                    // Descriptor for this vendor line number (core identity)
                    var currentLevel = { vendorLineNo: vendorLineNo };

                    // Attach parent reference if this node is not a root
                    if (parentLevel) currentLevel.parent = parentLevel;
                    if (topLevel) currentLevel.top = topLevel;

                    // Add to the sibling parts list (will become parent's parts array)
                    parts.push(currentLevel);

                    // Push into global flattened accumulator preserving traversal order (depth-first)
                    arrGroupedLineNos.push(currentLevel);

                    // If this node has nested children, recurse to build its parts array
                    if (!vc2_util.isEmpty(groupedLevel[vendorLineNo])) {
                        // Assign recursively discovered child descriptors to this node
                        currentLevel.parts = fnGroupLevel(
                            groupedLevel[vendorLineNo],
                            vendorLineNo,
                            currentLevel.top || vendorLineNo
                        );
                    }
                }
                // Return the assembled list of child descriptors to caller (becomes .parts on parent)
                return parts;
            };

            // (3) Seed recursion at root level
            fnGroupLevel(sortedVendorLineNos, null);

            // (4) Return flattened annotated list
            return arrGroupedLineNos;
        }
    };

    return {
        process_old: function (option) {
            var logTitle = [LogTitle, 'process'].join('::'),
                returnValue = {};
            option = option || {};
            var OUTPUT = null,
                RESPONSE = null;
            try {
                LibOrderStatus.initialize(option);

                LibOrderStatus.getTokenCache(option);
                if (!CURRENT.accessToken) throw 'Unable to generate access token';

                // get the validOrders
                var ingramOrderResponse = this.processRequest(option);
                OUTPUT = ingramOrderResponse.OUTPUT;
                RESPONSE = ingramOrderResponse.RESPONSE;

                var OrderLines = [];

                if (option.debugMode) {
                    if (!option.showLines) return RESPONSE;
                }
                vc2_util.log(logTitle, '*** Total Orders: ', OUTPUT.OrdersList);

                var logPrefix = '';

                var orderNumList = [];

                /// FIRST: Detect all the lines, and detect if its a Direct Ship Order ///
                for (var orderNum in RESPONSE.OrderDetails) {
                    var orderDetails = RESPONSE.OrderDetails[orderNum];
                    if (vc2_util.isEmpty(orderDetails)) continue;

                    logPrefix = '[' + orderNum + '] ';
                    vc2_util.log(logTitle, logPrefix + ' ... Order Details: ', orderDetails);

                    if (!vc2_util.inArray(orderNum, orderNumList)) orderNumList.push(orderNum);

                    // order lines by item_num, ship_qty
                    orderDetails.lines.sort(function (a, b) {
                        if (a.item_num === b.item_num) {
                            return a.ship_qty - b.ship_qty;
                        }
                        return a.item_num - b.item_num;
                    });

                    orderDetails.lines.forEach(function (ingramLine) {
                        var lineData = LibOrderStatus.extractLineData(ingramLine, orderDetails);

                        // check for is_shipped status
                        var isShippedStatus =
                            lineData.line_status && lineData.line_status !== 'NA'
                                ? vc2_util.inArray(
                                      lineData.line_status.toUpperCase(),
                                      LibIngramAPI.ValidShippedLineStatus
                                  )
                                : lineData.order_status && lineData.order_status !== 'NA'
                                  ? vc2_util.inArray(
                                        lineData.order_status.toUpperCase(),
                                        LibIngramAPI.ValidShippedStatus
                                    )
                                  : false;

                        // Ship status flag
                        util.extend(
                            lineData,
                            isShippedStatus
                                ? { is_shipped: true, valid_shipped_status: true }
                                : {
                                      is_shipped: false,
                                      ship_date: 'NA',
                                      valid_shipped_status: false
                                  }
                        );

                        // check if Direct Ship Order
                        var directShipOrderNum =
                                orderDetails.ingramOrderNumber +
                                ('-' + orderDetails.orderType) +
                                (' (' + ingramLine.vendorPartNumber + ')'),
                            vendorLineOrderNum =
                                orderDetails.ingramOrderNumber +
                                (lineData.vendor_lineno ? ' (' + lineData.vendor_lineno + ')' : '');

                        util.extend(lineData, {
                            order_type: orderDetails.orderType,
                            ordernum_ingram: orderDetails.ingramOrderNumber,
                            ordernum_direct: directShipOrderNum,
                            ordernum_vendorline: vendorLineOrderNum,
                            '** main_ordernum': orderNum,
                            '** ordernum_ingram': orderDetails.ingramOrderNumber,
                            '** ordernum_vendorline': vendorLineOrderNum
                        });

                        /// check for duplicate
                        var duplicateLine = OrderLines.filter(function (item) {
                            return (
                                item.item_num === lineData.item_num &&
                                item.order_num === lineData.order_num &&
                                item.line_num === lineData.line_num &&
                                item.main_ordernum === lineData.main_ordernum &&
                                item.vendor_lineno === lineData.vendor_lineno
                            );
                        });

                        if (!vc2_util.isEmpty(duplicateLine)) {
                            util.extend(lineData, {
                                is_duplicate: true
                            });
                            vc2_util.log(
                                logTitle,
                                logPrefix + '... Duplicate Line: ',
                                duplicateLine
                            );

                            return;
                        }
                        OrderLines.push(lineData);
                    });
                }

                // extract sorted vendor line numbers
                var vendorLineNos = LibOrderStatus.buildVendorLineHierarchy(OrderLines);
                vc2_util.log(logTitle, '... Vendor Line Nos: ', vendorLineNos);

                // determine the vendorLineNos hierarchy, and group by parts
                var arrOrganizedVendorLineNos =
                    LibOrderStatus.flattenVendorLineMap({
                        orderLines: OrderLines,
                        sortedVendorLineNos: vendorLineNos
                    }) || [];

                // sort the OrderLines by vendorLineno
                OrderLines.sort(function (a, b) {
                    return (a.vendor_lineno || 0) - (b.vendor_lineno || 0);
                });

                var fldsToCopy = [
                    'order_num',
                    'order_eta',
                    'deliv_eta',
                    'deliv_date',
                    'prom_date'
                    // 'ship_date',
                    // 'line_status',
                    // 'is_shipped'
                ];

                // loop thru the OrderLines
                OrderLines.forEach(function (lineData) {
                    // check if the vendor line number is empty
                    // if (lineData.order_num && lineData.order_num !== 'NA') return;

                    // backup the old values
                    fldsToCopy.forEach(function (field) {
                        lineData['_' + field] = lineData[field]; // backup old value
                    });

                    // check if there's vendor line number
                    if (lineData.vendor_lineno && lineData.vendor_lineno !== 'NA') {
                        // only attempt grouping logic if this line has a vendor lineno
                        var groupedVendorLine = arrOrganizedVendorLineNos.filter(
                            function (
                                // find the grouping metadata object for this vendor line
                                groupedLine
                            ) {
                                return groupedLine.vendorLineNo === lineData.vendor_lineno; // match on exact vendor line number
                            }
                        );

                        if (groupedVendorLine && groupedVendorLine.length) {
                            // proceed only if grouping metadata found
                            groupedVendorLine = groupedVendorLine.shift(); // take first (unique expected) match

                            var parentOrderLine = groupedVendorLine.top // resolve parent line (if this line is a child)
                                    ? OrderLines.filter(function (lineData) {
                                          // search original lines for parent lineno
                                          return (
                                              lineData.vendor_lineno === groupedVendorLine.top // match parent vendor_lineno
                                          );
                                      })
                                    : null,
                                partsOrderLine = groupedVendorLine.parts // resolve parts (children) if this line is a parent
                                    ? OrderLines.filter(function (lineData) {
                                          // filter lines that are part of this group
                                          var isMatched = false; // track membership

                                          groupedVendorLine.parts.forEach(function (partData) {
                                              // iterate child descriptors
                                              if (
                                                  lineData.vendor_lineno === partData.vendorLineNo // match child vendor line number
                                              ) {
                                                  isMatched = true; // mark inclusion
                                              }
                                          });
                                          return isMatched; // include only matched part lines
                                      })
                                    : null;

                            if (parentOrderLine && parentOrderLine.length) {
                                // if parent exists, align derived ordernum_vendorline with parent
                                lineData.ordernum_vendorline =
                                    parentOrderLine[0].ordernum_vendorline; // inherit vendorline order reference
                            }

                            // Collect potential overrides for selected fields from parent or child parts
                            var partsLineData = {}; // accumulator for resolved field overrides
                            fldsToCopy.forEach(function (field) {
                                // iterate over candidate fields for inheritance
                                if (lineData[field] && lineData[field] !== 'NA') return; // skip if current line already has a real value

                                var parentLineValue = (function () {
                                        // derive value from parent if available
                                        // if parentOrderLine is not empty, then return the first order_num
                                        return parentOrderLine && // parent exists
                                            parentOrderLine.length && // has entries
                                            !vc2_util.isEmpty(parentOrderLine[0][field]) && // field populated
                                            parentOrderLine[0][field] !== 'NA' // not sentinel
                                            ? parentOrderLine[0][field] // adopt parent value
                                            : 'NA'; // else sentinel
                                    })(),
                                    partsLineValue = (function () {
                                        // derive value from child parts if any
                                        // loop thru the parts, and check if any of the parts have an order_num
                                        var partsOrderNum = []; // collected candidate child field values
                                        if (partsOrderLine && partsOrderLine.length) {
                                            // only inspect if children present
                                            for (var i = 0, j = partsOrderLine.length; i < j; i++) {
                                                // iterate child lines
                                                if (
                                                    !vc2_util.isEmpty(partsOrderLine[i][field]) && // has value
                                                    partsOrderLine[i][field] !== 'NA' // not sentinel
                                                ) {
                                                    partsOrderNum.push(partsOrderLine[i][field]); // record first occurrences (order preserved)
                                                }
                                            }
                                        }
                                        return partsOrderNum.length ? partsOrderNum[0] : 'NA'; // prefer first child value or sentinel
                                    })();

                                partsLineData[field] = // choose best hierarchical value precedence: child > parent > original
                                    !vc2_util.isEmpty(partsLineValue) && partsLineValue !== 'NA' // prefer child-derived value if valid
                                        ? partsLineValue
                                        : // check for parent orderLineValue
                                          !vc2_util.isEmpty(parentLineValue) &&
                                            parentLineValue !== 'NA'
                                          ? parentLineValue // fallback to parent
                                          : lineData[field]; // else keep original (likely 'NA')

                                return true; // continue to next field
                            });

                            vc2_util.log(logTitle, logPrefix + '... grouped vendor line: ', [
                                // debug log showing resolved inheritance
                                lineData,
                                partsLineData
                            ]);

                            // extend the lineData with the resolved hierarchical overrides
                            util.extend(lineData, partsLineData);
                        }
                    }

                    // check if the order_num is empty, then check the parent, or child
                    if (lineData.vendor_lineno && lineData.vendor_lineno !== 'NA') {
                        lineData.order_num = lineData.ordernum_vendorline;
                    } else if (!lineData.order_num || lineData.order_num === 'NA') {
                        lineData.order_num = lineData.ordernum_direct;
                    }

                    return true;
                });
                /// try to detect all the ordersLIst
                var OrdersList = {};
                OrderLines.forEach(function (lineData) {
                    /// SET the date values
                    DATE_FIELDS.forEach(function (dateField) {
                        if (!lineData[dateField] || lineData[dateField] == 'NA') return;
                        lineData[dateField] = vc2_util.parseToVCDateStandard(lineData[dateField]);
                        var parsedDate = vc2_util.parseToVCDateStandard(lineData[dateField]);
                        lineData[dateField] =
                            parsedDate && !parsedDate.match(/Invalid/i)
                                ? parsedDate
                                : lineData[dateField];
                    });

                    var orderNum = lineData.order_num;
                    if (OrdersList[orderNum]) return;

                    var ingramOrderNum = lineData.ordernum_ingram || lineData.ingram_subordernum;

                    // get the orderInfo from the OUTPUT.OrdersList

                    var orderInfo = {},
                        directMatch = (function () {
                            var result = OUTPUT.OrdersList.filter(function (orderData) {
                                return orderData.VendorOrderNum === orderNum;
                            });
                            return result.length ? result : null;
                        })(),
                        ingramMatch = (function () {
                            var result = OUTPUT.OrdersList.filter(function (orderData) {
                                return orderData.IngramOrderNum === ingramOrderNum;
                            });
                            return result.length ? result : null;
                        })();

                    if (directMatch && directMatch.length) {
                        orderInfo = directMatch.shift();
                    } else {
                        orderInfo = vc2_util.extend(ingramMatch ? ingramMatch.shift() : {}, {
                            VendorOrderNum: orderNum,
                            IngramOrderNum: lineData.ordernum_ingram,
                            OrderDate: lineData.order_date,
                            OrderNum: lineData.order_num,
                            Status: lineData.order_status,
                            Total: 0
                        });
                    }

                    OrdersList[orderNum] = orderInfo;
                });

                util.extend(returnValue, {
                    Orders: (function () {
                        var result = [];
                        for (var orderNum in OrdersList) {
                            if (OrdersList.hasOwnProperty(orderNum)) {
                                result.push(OrdersList[orderNum]);
                            }
                        }
                        return result;
                    })(),
                    Lines: OrderLines,
                    Source: RESPONSE
                });
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            } finally {
                vc2_util.log(logTitle, '// Return', returnValue);
            }

            return returnValue;
        },
        process: function (option) {
            var logTitle = [LogTitle, 'process'].join('::'),
                returnValue = {};
            option = option || {};
            // Working containers
            var OUTPUT = null,
                SourceData = null,
                OrderLines = [];

            /*
             High-Level Flow:
               1. Initialize + authenticate.
               2. Fetch raw order + line data (processRequest).
               3. Normalize each line (extractLineData) -> OrderLines (flat).
               4. Enrich (ship status, parsed dates, proposed order numbers, duplicate tagging).
               5. Build vendor line hierarchy per Ingram order.
               6. Apply hierarchical inheritance (child > parent > original) with backups (__<field>).
               7. Reconstruct unique Orders list from lines.
               8. Return { Orders, Lines, Source }.

             Post-Hierarchy line sample (illustrative):
             {
               order_num: '12-34567-89 (1.1)',      // final chosen order reference
               order_eta: '2024-06-05',             // possibly inherited
               deliv_eta: '2024-06-06',
               deliv_date: '2024-06-06',
               prom_date: '2024-06-04',
               vendor_lineno: '1.1',                // hierarchy key
               ordernum_vendorline: '12-34567-89 (1.1)',
               ordernum_direct: '12-34567-89-DIRECT (SKU-ABC)',
               ordernum_ingram: '12-34567-89',
               ordernum_main: 'PO-2024-001',
               is_shipped: true,
               __order_num: 'SUB-001',              // original before inheritance
               __order_eta: 'NA',                   // backup original
               __deliv_eta: 'NA',
               __deliv_date: 'NA',
               __prom_date: 'NA',
               IS_DUPLICATE: null
             }

             OrdersList entry sample:
             {
               VendorOrderNum: '12-34567-89 (1.1)',
               IngramOrderNum: '12-34567-89',
               OrderDate: '2024-06-01',
               OrderNum: '12-34567-89 (1.1)',
               Status: 'SHIPPED',
               Total: 0
             }
            */
            try {
                // (1) Init + token
                LibOrderStatus.initialize(option);
                LibOrderStatus.getTokenCache(option);
                if (!CURRENT.accessToken) throw 'Unable to generate access token';

                // (2) Fetch raw data bundle
                var ingramOrderResponse = this.processRequest(option);
                OUTPUT = ingramOrderResponse.OUTPUT;
                SourceData = ingramOrderResponse.RESPONSE;

                // (2a) Debug shortcut
                if (option.debugMode && !option.showLines) return SourceData;

                vc2_util.log(logTitle, '*** Total Orders: ', OUTPUT.OrdersList);

                var orderNumList = [];

                // (3) Walk each Ingram order container
                for (var orderNum in SourceData.OrderDetails) {
                    var logPrefix = '[' + orderNum + '] ';
                    var orderDetails = SourceData.OrderDetails[orderNum];
                    if (vc2_util.isEmpty(orderDetails)) continue;

                    if (!vc2_util.inArray(orderNum, orderNumList)) orderNumList.push(orderNum);
                    vc2_util.log(logTitle, logPrefix + '... Order Details', orderDetails);

                    // Stable grouping for deterministic duplicate detection (simple heuristic)
                    orderDetails.lines.sort(function (a, b) {
                        if (a.item_num === b.item_num) return a.ship_qty - b.ship_qty;
                        return a.item_num - b.item_num;
                    });

                    // (4) Normalize + enrich each raw line
                    orderDetails.lines.forEach(function (ingramLine) {
                        // Base normalized structure
                        var lineData = LibOrderStatus.extractLineData(ingramLine, orderDetails);

                        // // Head line detection: vendor_lineno pattern X.0 (e.g., 1.0, 2.0)
                        // if (lineData.vendor_lineno && /^\d+\.0$/.test(lineData.vendor_lineno)) {
                        //     lineData.main_item = true;
                        // }

                        var isShippedStatus =
                            lineData.line_status && lineData.line_status !== 'NA'
                                ? vc2_util.inArray(
                                      lineData.line_status.toUpperCase(),
                                      LibIngramAPI.ValidShippedLineStatus
                                  )
                                : lineData.order_status && lineData.order_status !== 'NA'
                                  ? vc2_util.inArray(
                                        lineData.order_status.toUpperCase(),
                                        LibIngramAPI.ValidShippedStatus
                                    )
                                  : false;

                        // Ship status flag
                        util.extend(
                            lineData,
                            isShippedStatus
                                ? { is_shipped: true, valid_shipped_status: true }
                                : {
                                      is_shipped: false,
                                      ship_date: 'NA',
                                      valid_shipped_status: false
                                  }
                        );

                        // Date normalization
                        DATE_FIELDS.forEach(function (dateField) {
                            if (!lineData[dateField] || lineData[dateField] === 'NA') return;
                            lineData[dateField] = vc2_util.parseToVCDateStandard(lineData[dateField]);
                            var parsedDate = vc2_util.parseToVCDateStandard(lineData[dateField]);
                            lineData[dateField] =
                                parsedDate && !parsedDate.match(/Invalid/i)
                                    ? parsedDate
                                    : lineData[dateField];
                        });

                        // Proposed order number variants (main / direct / vendorline)
                        util.extend(lineData, {
                            order_type: orderDetails.orderType,
                            ordernum_ingram: orderDetails.ingramOrderNumber,
                            ordernum_main: orderNum,
                            ordernum_direct:
                                orderDetails.ingramOrderNumber +
                                ('-' + orderDetails.orderType) +
                                (' (' + ingramLine.vendorPartNumber + ')'),
                            ordernum_vendorline:
                                orderDetails.ingramOrderNumber +
                                (lineData.vendor_lineno ? ' (' + lineData.vendor_lineno + ')' : '')
                        });

                        // Duplicate detection (conservative composite key)
                        var duplicateLine = OrderLines.filter(function (item) {
                            return (
                                item.item_num === lineData.item_num &&
                                item.order_num === lineData.order_num &&
                                item.line_num === lineData.line_num &&
                                item.ordernum === lineData.ordernum &&
                                item.vendor_lineno === lineData.vendor_lineno
                            );
                        });

                        if (!vc2_util.isEmpty(duplicateLine)) {
                            util.extend(lineData, { IS_DUPLICATE: JSON.stringify(duplicateLine) });
                            vc2_util.log(logTitle, logPrefix + '... Duplicate Line', duplicateLine);
                        }

                        FLDS_TO_BKUP.forEach(function (field) {
                            lineData['__' + field] = lineData[field]; // backup original value
                        });

                        OrderLines.push(lineData);
                    });
                }

                // (5) Build hierarchical Ingram order line items using vendor_lineno
                var listVendorLineNos = LibOrderStatus.buildVendorLineHierarchy(OrderLines);
                // {
                //   "12-345": {
                //     "1.1": { "1.1.1": {}, "1.1.2": {} },
                //     "2.1": {}
                //   },
                //   "98-765": {
                //     "1.1": {}
                //   }
                // }
                //

                // (6) Apply the vendorLineNo hierarchy to inherit fields downwards
                for (var orderNum in listVendorLineNos) {
                    var vendorLineNos = listVendorLineNos[orderNum],
                        orderNumLines = OrderLines.filter(function (lineData) {
                            return (
                                lineData.ordernum_ingram === orderNum ||
                                lineData.ordernum_main === orderNum
                            );
                        });

                    // Sort lines by vendor_lineno to ensure parents are processed before children
                    orderNumLines.sort(function (a, b) {
                        return (a.vendor_lineno || 0) - (b.vendor_lineno || 0);
                    });

                    // Flatten the vendor line number hierarchy, detect parts and parent
                    var nestedVendorLineNos = LibOrderStatus.flattenVendorLineMap({
                        orderLines: orderNumLines,
                        sortedVendorLineNos: vendorLineNos
                    });

                    // Walk each line in this Ingram order and resolve order_num + date field
                    // inheritance based on the vendor line number hierarchy (parent/child/standalone).
                    // Hierarchy key: vendor_lineno (e.g., 1.0 = parent, 1.1/1.2 = children).
                    // Inheritance priority: child adopts parent's values when its own are 'NA'.
                    orderNumLines.forEach(function (lineData) {
                        // --- GUARD: Lines without a vendor_lineno are not part of any hierarchy ---
                        // If the line has no vendor_lineno, it cannot participate in parent/child
                        // grouping. Fall back to ingram_subordernum or ordernum_main as order_num.
                        if (!Helper.getValidValue(lineData.vendor_lineno)) {
                            if (Helper.getValidValue(lineData.order_num))
                                lineData.order_num =
                                    Helper.getValidValue(lineData.ingram_subordernum) ||
                                    Helper.getValidValue(lineData.ordernum_main);

                            return;
                        }

                        // --- LOOKUP: Find this line's grouping metadata from the flattened hierarchy ---
                        // nestedVendorLineNos contains entries like:
                        //   { vendorLineNo: '1.1', top: '1.0', parts: [...] }
                        // where 'top' points to the root parent and 'parts' lists immediate children.
                        var listGrouping = nestedVendorLineNos.filter(function (g) {
                            return g.vendorLineNo === lineData.vendor_lineno;
                        });

                        // If this vendor_lineno isn't in the hierarchy map, skip it
                        if (!listGrouping || !listGrouping.length) return;

                        var groupedLine = listGrouping.shift(),
                            // --- RESOLVE PARENT: Find the top-level (root) line in the hierarchy ---
                            // groupedLine.top holds the root ancestor's vendor_lineno (e.g., '1.0').
                            // If present, locate the actual lineData object for that parent line.
                            topLine = groupedLine.top
                                ? orderNumLines.filter(function (l) {
                                      return l.vendor_lineno === groupedLine.top;
                                  })
                                : null,
                            // --- RESOLVE CHILDREN: Find all child/part lines under this line ---
                            // groupedLine.parts lists child descriptors (e.g., [{vendorLineNo:'1.1'}, ...]).
                            // Match each child descriptor against actual order lines by vendor_lineno.
                            partsLines = groupedLine.parts
                                ? orderNumLines.filter(function (l) {
                                      var m = false;
                                      groupedLine.parts.forEach(function (p) {
                                          if (!m && l.vendor_lineno === p.vendorLineNo) m = true;
                                      });
                                      return m;
                                  })
                                : null;

                        // --- ORDER_NUM DECISION: Three-way branch based on hierarchy position ---
                        if (topLine && topLine.length)
                            // CHILD LINE: Has a parent → inherit the parent's ordernum_vendorline
                            // e.g., line 1.1 adopts "ING-12345 (1.0)" from its parent line 1.0
                            lineData.order_num = topLine[0].ordernum_vendorline;
                        else if (!partsLines || !partsLines.length)
                            // STANDALONE LINE: No parent above, no children below → use ordernum_main
                            // (the raw Ingram order number without vendor_lineno suffix)
                            lineData.order_num = Helper.getValidValue(lineData.ordernum_main);
                        else {
                            // PARENT LINE: Has children but no parent above → use its own ordernum_vendorline
                            // e.g., "ING-12345 (1.0)" — this becomes the reference its children inherit
                            lineData.order_num = Helper.getValidValue(lineData.ordernum_vendorline);
                            lineData.main_item = true;
                        }
                        // --- FIELD INHERITANCE: Propagate date/order fields from parent to child ---
                        // For each field in FLDS_TO_BKUP (order_num, order_eta, ship_date, deliv_eta,
                        // deliv_date, prom_date), if the current line's value is empty/NA, attempt to
                        // adopt the parent's value.
                        var partsLineData = {};

                        FLDS_TO_BKUP.forEach(function (field) {
                            // Skip if this line already has a real (non-NA) value for the field
                            if (Helper.getValidValue(lineData[field])) return;

                            // Check parent line for a valid value to inherit
                            var parentLineValue =
                                topLine && topLine.length && Helper.getValidValue(topLine[0][field])
                                    ? topLine[0][field]
                                    : 'NA';

                            // Only override if parent has a real value and it differs from current
                            if (
                                Helper.getValidValue(parentLineValue) &&
                                lineData[field] !== parentLineValue
                            )
                                partsLineData[field] = parentLineValue;
                        });

                        // Apply all inherited field overrides to the line in a single merge
                        if (!vc2_util.isEmpty(partsLineData)) util.extend(lineData, partsLineData);
                    });
                }

                // (7) Build OrdersList from consolidated lines
                var OrdersList = {};
                OrderLines.forEach(function (lineData) {
                    var orderNum = lineData.order_num;
                    if (OrdersList[orderNum]) return;
                    var ingramOrderNum = lineData.ordernum_ingram || lineData.ingram_subordernum;
                    var matchedOrderNum = (function () {
                            var r = OUTPUT.OrdersList.filter(function (o) {
                                return o.VendorOrderNum === orderNum;
                            });
                            return r.length ? r : null;
                        })(),
                        matchedIngramOrderNum = (function () {
                            var r = OUTPUT.OrdersList.filter(function (o) {
                                return o.IngramOrderNum === ingramOrderNum;
                            });
                            return r.length ? r : null;
                        })();
                    var orderInfo =
                        matchedOrderNum && matchedOrderNum.length
                            ? matchedOrderNum.shift()
                            : vc2_util.extend(
                                  matchedIngramOrderNum ? matchedIngramOrderNum.shift() : {},
                                  {
                                      VendorOrderNum: orderNum,
                                      IngramOrderNum: lineData.ordernum_ingram,
                                      OrderDate: lineData.order_date,
                                      OrderNum: lineData.order_num,
                                      Status: lineData.order_status,
                                      Total: 0
                                  }
                              );
                    OrdersList[orderNum] = orderInfo;
                });

                // (8) Assemble return payload
                util.extend(returnValue, {
                    Orders: (function () {
                        var result = [];
                        for (var orderNum in OrdersList) {
                            if (OrdersList.hasOwnProperty(orderNum))
                                result.push(OrdersList[orderNum]);
                        }
                        return result;
                    })(),
                    Lines: OrderLines,
                    Source: SourceData
                });
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
            var OUTPUT = {},
                RESPONSE = {
                    OrderSearch: null,
                    OrderDetails: {}
                };
            try {
                LibOrderStatus.initialize(option);

                LibOrderStatus.getTokenCache(option);
                if (!CURRENT.accessToken) throw 'Unable to generate access token';

                // get the validOrders
                var orderSearchResults = LibIngramAPI.orderSearch();
                RESPONSE.OrderSearch = orderSearchResults;

                // get the valid orders
                var arrValidOrders = LibOrderStatus.extractValidOrders(orderSearchResults);

                vc2_util.log(logTitle, '... Valid Orders: ', arrValidOrders);

                OUTPUT.OrdersList = arrValidOrders;
                OUTPUT.Items = [];
                var errorV61 = '',
                    arrOrderV61Errors = [],
                    processedOrder = {};

                // only one call needed for order details
                arrValidOrders.forEach(function (orderResult) {
                    var ingramOrderNum = orderResult.IngramOrderNum || orderResult.VendorOrderNum;
                    if (processedOrder[ingramOrderNum]) return;

                    vc2_util.log(logTitle, '... processing: ', {
                        IngramOrderNum: orderResult.IngramOrderNum,
                        VendorOrderNum: orderResult.VendorOrderNum
                    });
                    if (vc2_util.isEmpty(ingramOrderNum)) return;

                    var orderDetails = LibIngramAPI.orderDetails({ orderNum: ingramOrderNum });
                    vc2_util.log(logTitle, '... >> result: ', orderDetails);

                    if (!orderDetails || !orderDetails.lines) return;
                    processedOrder[ingramOrderNum] = true;

                    /// SET the error if it has an error ///
                    if (
                        // check for orderDetails
                        (function () {
                            if (vc2_util.isEmpty(orderDetails)) {
                                errorV61 = 'Missing order details';
                                return true;
                            }
                            return false;
                        })() ||
                        // check for existence of lines
                        (function () {
                            if (vc2_util.isEmpty(orderDetails.lines)) {
                                errorV61 = 'Missing order detail lines';
                                return true;
                            }
                            return false;
                        })()
                    ) {
                        orderResult.hasErrors = true;
                        orderResult.error = errorV61;
                        arrOrderV61Errors.push(orderResult);

                        errorV61 = [errorV61, orderResult.VendorOrderNum].join(' - ');
                        CURRENT.hasV61Errors = true;

                        return;
                    }
                    ///

                    RESPONSE.OrderDetails[orderResult.VendorOrderNum] = orderDetails;
                });

                if (CURRENT.isV61 && CURRENT.hasV61Errors) {
                    vc2_util.log(logTitle, '***** [V6.1] Error: ', [errorV61, arrOrderV61Errors]);

                    // loop thru the validOrdersList
                    arrOrderV61Errors.forEach(function (orderResult) {
                        // vc2_util.log(logTitle, '... validOrder: ', orderResult);

                        var orderDetails = LibIngramAPI.orderDetails({
                            orderNum: orderResult.VendorOrderNum,
                            endpointUrl: LibIngramAPI.EndPointV6
                        });
                        if (vc2_util.isEmpty(orderDetails)) return;
                        RESPONSE.OrderDetails[orderResult.VendorOrderNum] = orderDetails;
                    });
                }

                returnValue = {
                    OUTPUT: OUTPUT,
                    RESPONSE: RESPONSE
                };
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        }
    };
});
