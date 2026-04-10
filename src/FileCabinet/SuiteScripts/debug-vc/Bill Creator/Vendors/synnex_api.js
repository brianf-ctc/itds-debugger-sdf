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
 * Script Name: VAR Connect Bill Creator - SYNNEX API Adapter
 * @author brianf@nscatalyst.com
 * @description Vendor adapter library used by VAR Connect Bill Creator to call the SYNNEX invoice API, normalize responses, and feed Bill File creation.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-19   brianf                Hardened input validation/error handling; standardized module imports; added vclib_error for error
 *                                    logging; refactored processXml as direct library object property; consolidated helper functions
 *                                    (xml2json, getInvoiceDetails, extractInvoicesFromResponse) into Helper object; implemented
 *                                    intelligent charge allocation: loops Shipping/Freight to fill invoice gap into a single
 *                                    myObj.charges.shipping value, prioritizes exact-gap matches, marks allocation status, and
 *                                    stores discounted portions in myObj.discounted array
 * 2023-05-26   raf                   Initial build
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    //Native modules
    var ns_log = require('N/log'),
        ns_xml = require('N/xml');

    //Library modules
    var vclib_utils = require('../../Services/lib/ctc_lib_utils.js'),
        vclib_constants = require('../../Services/lib/ctc_lib_constants.js'),
        // Added: vclib_error for standardized error logging per VAR Connect standards
        vclib_error = require('../../Services/lib/ctc_lib_error.js');

    //Constants
    var LogTitle = 'WS:SynnexAPI',
        ERROR_MSG = vclib_constants.ERROR_MSG || {};

    var NodeType = {
        ELEMENT: ns_xml.NodeType.ELEMENT_NODE, //1
        TEXT: ns_xml.NodeType.TEXT_NODE, //3
        CDATA: ns_xml.NodeType.CDATA_SECTION_NODE, //4
        DOCUMENT: ns_xml.NodeType.DOCUMENT_NODE //9
    };

    var Helper = {
        /**
         * @function xml2json
         * @description Converts an XML node to a JavaScript object recursively.
         * @param {Object} xml - XML node to parse
         * @returns {Object} Parsed JavaScript object
         */
        xml2json: function (xml) {
            var X = {
                toObj: function (xml) {
                    var o = {};
                    if (xml.nodeType == NodeType.ELEMENT) {
                        // element node ..
                        if (xml.attributes.length)
                            // element with attributes  ..
                            for (var i = 0; i < xml.attributes.length; i++)
                                o['@' + xml.attributes[i].nodeName] = (
                                    xml.attributes[i].nodeValue || ''
                                ).toString();
                        if (xml.firstChild) {
                            // element has child nodes ..
                            var textChild = 0,
                                cdataChild = 0,
                                hasElementChild = false;
                            for (var n = xml.firstChild; n; n = n.nextSibling) {
                                if (n.nodeType == NodeType.ELEMENT) hasElementChild = true;
                                else if (
                                    n.nodeType == NodeType.TEXT &&
                                    n.nodeValue.match(/[^ \f\n\r\t\v]/)
                                )
                                    textChild++;
                                // non-whitespace text
                                else if (n.nodeType == NodeType.CDATA) cdataChild++; // cdata section node
                            }
                            if (hasElementChild) {
                                if (textChild < 2 && cdataChild < 2) {
                                    // structured element with evtl. a single text or/and cdata node ..
                                    X.removeWhite(xml);
                                    for (var n = xml.firstChild; n; n = n.nextSibling) {
                                        if (n.nodeType == NodeType.TEXT)
                                            // text node
                                            o['#text'] = X.escape(n.nodeValue);
                                        else if (n.nodeType == NodeType.CDATA)
                                            // cdata node
                                            o['#cdata'] = X.escape(n.nodeValue);
                                        else if (o[n.nodeName]) {
                                            // multiple occurence of element ..
                                            if (o[n.nodeName] instanceof Array)
                                                o[n.nodeName][o[n.nodeName].length] = X.toObj(n);
                                            else o[n.nodeName] = [o[n.nodeName], X.toObj(n)];
                                        } // first occurence of element..
                                        else o[n.nodeName] = X.toObj(n);
                                    }
                                } else {
                                    // mixed content
                                    if (!xml.attributes.length) o = X.escape(X.innerXml(xml));
                                    else o['#text'] = X.escape(X.innerXml(xml));
                                }
                            } else if (textChild) {
                                // pure text
                                if (!xml.attributes.length) o = X.escape(X.innerXml(xml));
                                else o['#text'] = X.escape(X.innerXml(xml));
                            } else if (cdataChild) {
                                // cdata
                                if (cdataChild > 1) o = X.escape(X.innerXml(xml));
                                else
                                    for (var n = xml.firstChild; n; n = n.nextSibling)
                                        o['#cdata'] = X.escape(n.nodeValue);
                            }
                        }
                        if (!xml.attributes.length && !xml.firstChild) o = null;
                    } else if (xml.nodeType == NodeType.DOCUMENT) {
                        // document.node
                        o = X.toObj(xml.documentElement);
                    } else ns_log.debug('xml2json', 'unhandled node type: ' + xml.nodeType);
                    return o;
                },
                toJson: function (o, name, ind) {
                    var json = name ? '"' + name + '"' : '';
                    if (o instanceof Array) {
                        for (var i = 0, n = o.length; i < n; i++)
                            o[i] = X.toJson(o[i], '', ind + '');
                        json +=
                            (name ? ':[' : '[') +
                            (o.length > 1
                                ? '' + ind + '' + o.join(',' + ind + '') + '' + ind
                                : o.join('')) +
                            ']';
                    } else if (o == null) json += (name && ':') + 'null';
                    else if (typeof o == 'object') {
                        var arr = [];
                        for (var m in o) arr[arr.length] = X.toJson(o[m], m, ind + '');
                        json +=
                            (name ? ':{' : '{') +
                            (arr.length > 1
                                ? '' + ind + '' + arr.join(',' + ind + '') + '' + ind
                                : arr.join('')) +
                            '}';
                    } else if (typeof o == 'string')
                        json += (name && ':') + '"' + o.toString() + '"';
                    else json += (name && ':') + o.toString();
                    return json;
                },
                innerXml: function (node) {
                    var s = '';
                    if ('innerHTML' in node) s = node.innerHTML;
                    else {
                        var asXml = function (n) {
                            var s = '';
                            if (n.nodeType == NodeType.ELEMENT) {
                                s += '<' + n.nodeName;
                                for (var i = 0; i < n.attributes.length; i++)
                                    s +=
                                        ' ' +
                                        n.attributes[i].nodeName +
                                        '="' +
                                        (n.attributes[i].nodeValue || '').toString() +
                                        '"';
                                if (n.firstChild) {
                                    s += '>';
                                    for (var c = n.firstChild; c; c = c.nextSibling) s += asXml(c);
                                    s += '</' + n.nodeName + '>';
                                } else s += '/>';
                            } else if (n.nodeType == NodeType.TEXT) s += n.nodeValue;
                            else if (n.nodeType == NodeType.CDATA)
                                s += '<![CDATA[' + n.nodeValue + ']]>';
                            return s;
                        };
                        for (var c = node.firstChild; c; c = c.nextSibling) s += asXml(c);
                    }
                    return s;
                },
                escape: function (txt) {
                    return (
                        txt &&
                        txt
                            .replace(/[\\]/g, '\\\\')
                            .replace(/[\"]/g, '\\"')
                            .replace(/[\n]/g, '\\n')
                            .replace(/[\r]/g, '\\r')
                    );
                },
                removeWhite: function (e) {
                    e.normalize();
                    for (var n = e.firstChild; n; ) {
                        if (n.nodeType == NodeType.TEXT) {
                            // text node
                            if (n.nodeValue && !n.nodeValue.match(/[^ \f\n\r\t\v]/)) {
                                // pure whitespace text node
                                var nxt = n.nextSibling;
                                e.removeChild(n);
                                n = nxt;
                            } else n = n.nextSibling;
                        } else if (n.nodeType == NodeType.ELEMENT) {
                            // element node
                            X.removeWhite(n);
                            n = n.nextSibling;
                        } // any other node
                        else n = n.nextSibling;
                    }
                    return e;
                }
            };
            if (xml.nodeType == NodeType.DOCUMENT)
                // document node
                xml = xml.documentElement;
            var json = X.toJson(X.toObj(X.removeWhite(xml)), xml.nodeName, '');
            var jsonText = '{' + json.replace(/\t|\n/g, '') + '}';
            jsonText = jsonText
                .replace(/\b&\b/gm, '&amp;')
                .replace(/\\t|\t/gm, '    ')
                .replace(/\\n|\n/gm, '');
            return JSON.parse(jsonText);
        },

        /**
         * @function getInvoiceDetails
         * @description Calls the SYNNEX API to retrieve invoice details for a given PO.
         * @param {Object} option - Configuration object
         * @param {Object} option.config - SYNNEX API credentials and endpoint
         * @param {string} [option.recordId] - NetSuite record ID for logging context
         * @returns {string|null} returnValue - Raw XML response body, or null on failure
         */
        getInvoiceDetails: function (option) {
            var logTitle = [LogTitle, 'getInvoiceDetails'].join('::'),
                returnValue;

            try {
                // Fixed: default and validate option values inside try/catch to avoid pre-try runtime exceptions.
                option = option || {};

                var config = option.config || {},
                    recordId = option.recordId || null;

                vclib_utils.log(logTitle, '// params: ', option);

                if (
                    !config.url ||
                    !config.user_id ||
                    !config.user_pass ||
                    !config.partner_id ||
                    !config.poNum
                ) {
                    throw (
                        ERROR_MSG.MISSING_CONFIG ||
                        'Missing required SYNNEX API configuration values'
                    );
                }

                if (
                    config.useTestResponse === true &&
                    typeof testResponsePO !== 'undefined' &&
                    testResponsePO[config.poNum]
                ) {
                    return testResponsePO[config.poNum];
                }

                // do the request
                var invoiceDetReq = vclib_utils.sendRequest({
                    header: [LogTitle, 'Invoice Details'].join(' '),
                    method: 'post',
                    recordId: recordId,
                    isXML: true,
                    query: {
                        url: config.url,
                        headers: {
                            Accept: '*/*',
                            'Content-Type': 'application/xml'
                        },
                        body:
                            '<?xml version="1.0" encoding="UTF-8"?>' +
                            '<SynnexB2B version="2.2">' +
                            '<Credential>' +
                            ('<UserID>' + config.user_id + '</UserID>') +
                            ('<Password>' + config.user_pass + '</Password>') +
                            '</Credential>' +
                            '<InvoiceRequest>' +
                            ('<CustomerNumber>' + config.partner_id + '</CustomerNumber>') +
                            ('<PONumber>' + config.poNum + '</PONumber>') +
                            '</InvoiceRequest>' +
                            '</SynnexB2B>'
                    }
                });

                vclib_utils.handleXMLResponse(invoiceDetReq);

                if (invoiceDetReq.isError) throw invoiceDetReq.errorMsg;
                var invoiceDetResp = invoiceDetReq.RESPONSE.body;
                if (!invoiceDetResp) throw 'Unable to fetch server response';
                returnValue = invoiceDetResp;
            } catch (error) {
                // Fixed: replaced vclib_utils.logError with vclib_error.log per VAR Connect standards
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        },

        /**
         * @function extractInvoicesFromResponse
         * @description Parses a SYNNEX XML invoice response and returns normalized invoice objects.
         * @param {string} response - Raw XML response string from the SYNNEX API
         * @returns {Array} returnArr - Array of normalized invoice objects ({ ordObj, xmlStr })
         */
        extractInvoicesFromResponse: function (response) {
            var logTitle = [LogTitle, 'extractInvoice'].join('::');

            var returnArr = [];
            try {
                // Fixed: return safely when API response is empty instead of allowing parser errors.
                if (vclib_utils.isEmpty(response)) {
                    return returnArr;
                }

                var xmlObj = ns_xml.Parser.fromString(response);
                var xmlInvoice = ns_xml.XPath.select({
                    node: xmlObj,
                    xpath: '//SynnexB2B/InvoiceResponse/Invoice'
                });

                if (!util.isArray(xmlInvoice) || !xmlInvoice.length) {
                    return returnArr;
                }

                var xmlInvoiceResponse = ns_xml.XPath.select({
                    node: xmlObj,
                    xpath: '//SynnexB2B/InvoiceResponse'
                });

                var stPoNumber = '';
                if (
                    util.isArray(xmlInvoiceResponse) &&
                    !vclib_utils.isEmpty(xmlInvoiceResponse[0])
                ) {
                    var objInvoiceResponse = Helper.xml2json(xmlInvoiceResponse[0]);
                    if (
                        util.isObject(objInvoiceResponse) &&
                        util.isObject(objInvoiceResponse.InvoiceResponse)
                    ) {
                        stPoNumber = objInvoiceResponse.InvoiceResponse.CustomerPONumber || '';
                    }
                }

                for (var i = 0; i < xmlInvoice.length; i++) {
                    var jsonObj = Helper.xml2json(xmlInvoice[i], '');
                    var invoiceData = jsonObj && jsonObj.Invoice ? jsonObj.Invoice : {};
                    var summaryData = util.isObject(invoiceData.Summary) ? invoiceData.Summary : {};
                    var itemsData = util.isObject(invoiceData.Items) ? invoiceData.Items : {};

                    var myObj = {
                        po: invoiceData.CustomerPONumber || stPoNumber,
                        date: invoiceData.InvoiceDate,
                        invoice: invoiceData.InvoiceNumber,
                        charges: {
                            tax: 0,
                            other: 0,
                            shipping: 0
                        },
                        discounted: [],
                        total: vclib_utils.parseFloat(summaryData.TotalInvoiceAmount),
                        lines: []
                    };

                    // Fixed: Store initial charge calculations for later assessment
                    var taxAmount = vclib_utils.parseFloat(summaryData.SalesTax);
                    var otherAmount =
                        vclib_utils.parseFloat(summaryData.MinOrderFee) +
                        vclib_utils.parseFloat(summaryData.ProcessingFee) +
                        vclib_utils.parseFloat(summaryData.RecyclingFee) +
                        vclib_utils.parseFloat(summaryData.BoxCharge);

                    myObj.charges.tax = taxAmount;
                    myObj.charges.other = otherAmount;

                    vclib_utils.log(logTitle, '... myObj:', myObj);

                    // Fixed: normalize line payload to a safe array before iterating.
                    if (!util.isArray(itemsData.Item)) {
                        itemsData.Item = vclib_utils.isEmpty(itemsData.Item)
                            ? []
                            : [itemsData.Item];
                    }

                    // check for tracking
                    var invoiceTracking =
                            invoiceData.Tracking && invoiceData.Tracking.TrackNumber
                                ? invoiceData.Tracking.TrackNumber
                                : null,
                        arrTrackingNos;
                    if (!vclib_utils.isEmpty(invoiceTracking)) {
                        vclib_utils.log(logTitle, '... tracking nos:', invoiceTracking);
                        var arrTracking = invoiceTracking.split(/\s*,\s*/g);

                        arrTrackingNos = vclib_utils.uniqueArray(arrTracking);
                        vclib_utils.log(logTitle, '... tracking nos:', arrTrackingNos);
                    }

                    // Fixed: track line subtotal to determine which charges apply vs. are discounted
                    var lineSubtotal = 0;

                    for (var ii = 0, jj = itemsData.Item.length; ii < jj; ii++) {
                        var itemData = itemsData.Item[ii] || {};

                        var itemObj = {
                            processed: false,
                            // Fixed: support both legacy and corrected key names from vendor payload.
                            ITEMNO:
                                itemData.ManuafacturerPartNumber || itemData.ManufacturerPartNumber,
                            SKU: itemData.SKU,
                            PRICE: vclib_utils.parseFloat(itemData.UnitPrice),
                            QUANTITY: vclib_utils.parseFloat(itemData.ShipQuantity),
                            DESCRIPTION: itemData.ProductDescription
                        };

                        lineSubtotal += vclib_utils.roundOff(itemObj.PRICE * itemObj.QUANTITY);
                        vclib_utils.log(logTitle, '... line subtotal (running):', lineSubtotal);

                        // check for serials
                        var itemSerialNos = itemData.SerialNo,
                            arrSerialNos = [];

                        if (itemSerialNos && itemSerialNos.length) {
                            if (!util.isArray(itemSerialNos)) itemSerialNos = [itemSerialNos];
                            vclib_utils.log(logTitle, '... serial nos:', itemSerialNos);

                            itemSerialNos.forEach(function (seriaNo) {
                                // remove the 'SN:'
                                seriaNo = seriaNo.replace(/^SN:\s*/gi, '');
                                arrSerialNos.push(seriaNo);
                                return true;
                            });

                            vclib_utils.log(logTitle, '... serial nos:', arrSerialNos);
                            itemObj.SERIAL = vclib_utils.uniqueArray(arrSerialNos);
                        }

                        if (!vclib_utils.isEmpty(arrTrackingNos)) itemObj.TRACKING = arrTrackingNos;

                        vclib_utils.log(logTitle, '... itemObj:', itemObj);
                        myObj.lines.push(itemObj);
                    }

                    // Fixed: evaluate Shipping and Freight together, and store discounted portions as an array
                    var shippingCharges = {
                        shipping: !vclib_utils.isEmpty(summaryData.Shipping)
                            ? vclib_utils.roundOff(vclib_utils.parseFloat(summaryData.Shipping), 2)
                            : 0,
                        freight: !vclib_utils.isEmpty(summaryData.Freight)
                            ? vclib_utils.roundOff(vclib_utils.parseFloat(summaryData.Freight), 2)
                            : 0
                    };
                    var listShippingCharges = [];

                    if (shippingCharges.shipping > 0) {
                        listShippingCharges.push({
                            name: 'Shipping',
                            amount: shippingCharges.shipping,
                            applied: false
                        });
                    }

                    if (
                        shippingCharges.freight > 0 &&
                        shippingCharges.freight != shippingCharges.shipping
                    ) {
                        listShippingCharges.push({
                            name: 'Freight',
                            amount: shippingCharges.freight,
                            applied: false
                        });
                    }

                    vclib_utils.log(logTitle, '... shipping charge list (pre-allocation):', [
                        shippingCharges,
                        listShippingCharges
                    ]);

                    // line subtotal + non-shipping charges determines the remaining gap for Shipping/Freight
                    var baseSubtotal = vclib_utils.roundOff(
                        lineSubtotal + taxAmount + otherAmount,
                        2
                    );
                    var runningDiff = vclib_utils.roundOff(myObj.total - baseSubtotal, 2);

                    vclib_utils.log(logTitle, '... invoiceTotal, baseSubtotal, runningDiff :', [
                        myObj.total,
                        baseSubtotal,
                        runningDiff
                    ]);

                    if (runningDiff <= 0) {
                        // all of the shipping Charges are discounted
                        myObj.discounted = listShippingCharges;

                        vclib_utils.log(
                            logTitle,
                            '... all shipping charge are discounted ',
                            listShippingCharges
                        );
                    } else {
                        // loop thru the shipping charge and see if it fills up
                        var remainingGap = runningDiff;
                        var result = Helper.findBestCombination(remainingGap, listShippingCharges);

                        // process the applied
                        ((result && result.list) || []).map(function (shipCharge) {
                            shipCharge.applied = true;
                        });

                        listShippingCharges.forEach(function (shipCharge) {
                            if (shipCharge.applied) {
                                // add to the shipping charge
                                myObj.charges.shipping += shipCharge.amount;
                            } else {
                                myObj.discounted.push(shipCharge);
                            }
                        });
                    }

                    returnArr.push({ ordObj: myObj, xmlStr: response });
                }
            } catch (error) {
                // Fixed: replaced vclib_utils.logError with vclib_error.log per VAR Connect standards
                vclib_error.log(logTitle, error);
            }

            return returnArr;
        },

        findBestCombination: function (targetAmount, shipCharges) {
            var bestResult = null;

            var fnGapCheck = function (index, currentSum, currentCombo) {
                // Only consider combinations that are >= target (exact or over)
                if (currentSum >= targetAmount) {
                    var currentDiff = currentSum - targetAmount;

                    if (
                        bestResult === null ||
                        currentDiff < bestResult.diff ||
                        (currentDiff === bestResult.diff &&
                            currentCombo.length < bestResult.combination.length)
                    ) {
                        bestResult = {
                            total: currentSum,
                            combination: currentCombo.slice(),
                            diff: currentDiff
                        };
                    }
                    // Since all amounts are positive, adding more items will only increase the sum.
                    // We stop here because any further recursion in this branch will be further from the target.
                    return;
                }

                // Stop if we reached the end of the list
                if (index === shipCharges.length) {
                    return;
                }

                for (var i = index; i < shipCharges.length; i++) {
                    // Skip 0 or negative amounts to prevent infinite loops
                    if (shipCharges[i].amount <= 0) {
                        continue;
                    }

                    currentCombo.push(shipCharges[i]);
                    fnGapCheck(i + 1, currentSum + shipCharges[i].amount, currentCombo);
                    currentCombo.pop();
                }
            };

            fnGapCheck(0, 0, []);

            // If no combination covers the gap (e.g., total sum of all charges < target),
            // you might want to return the closest possible sum under the target as a fallback.
            return bestResult
                ? {
                      total: bestResult.total,
                      list: bestResult.combination
                  }
                : null;
        }
    };

    // Fixed: moved processXml directly into library object per Library Object Pattern standard
    var SynnexApiAdapter = {
        /**
         * @function processXml
         * @description Fetches invoice details from the SYNNEX API and returns normalized invoice objects.
         * @param {Object|string} option - Configuration object, or legacy recordId string for backward compatibility
         * @param {string}  [option.recordId]   - NetSuite internal record ID for logging context
         * @param {Object}  [option.config]     - SYNNEX API configuration values
         * @param {string}  [option.config.url]        - SYNNEX API endpoint URL
         * @param {string}  [option.config.user_id]    - SYNNEX API user ID
         * @param {string}  [option.config.user_pass]  - SYNNEX API password
         * @param {string}  [option.config.partner_id] - SYNNEX customer/partner number
         * @param {string}  [option.config.poNum]      - Purchase Order number to query
         * @param {Object}  [config] - Legacy second parameter; used when called as processXml(recordId, config)
         * @returns {Array} returnValue - Array of normalized invoice objects ({ ordObj, xmlStr })
         */
        processXml: function (option, config) {
            var logTitle = [LogTitle, 'processXml'].join('::'),
                returnValue = [];

            try {
                // Fixed: keep backward compatibility with processXml(recordId, config) while supporting option object pattern.
                option = util.isObject(option)
                    ? option
                    : {
                          recordId: option || null,
                          config: config || {}
                      };

                option.recordId = option.recordId || null;
                option.config = option.config || {};

                vclib_utils.log(logTitle, '// params: ', option);

                var respInvoiceDetails = Helper.getInvoiceDetails({
                    config: option.config,
                    recordId: option.recordId
                });

                returnValue = Helper.extractInvoicesFromResponse(respInvoiceDetails);
            } catch (error) {
                // Fixed: replaced vclib_utils.logError with vclib_error.log per VAR Connect standards
                vclib_error.log(logTitle, error);
            }

            return returnValue;
        }
    };

    var testResponsePO = {
        PO328628:
            '<?xml version="1.0" encoding="UTF-8"?><SynnexB2B><InvoiceResponse><CustomerPONumber>PO328628</CustomerPONumber><Invoice><InvoiceDate>2026-02-03</InvoiceDate><InvoiceNumber>170746125</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-02-03</ShipDate><InternalReferenceNumber>38854425</InternalReferenceNumber><Tracking><TrackNumber>499143345793,499143345782</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>2</ShipQuantity><UnitPrice>6,858.5200</UnitPrice><SynnexPartNumber>CSC-N9K-C93180YC-FX3</SynnexPartNumber><ManuafacturerPartNumber>N9K-C93180YC-FX3</ManuafacturerPartNumber><SKU>6183596</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>889728175692</UPCCode><ProductDescription>Nexus 9300 48p 1/10/25G, 6p 40/100G, MACsec,SyncE</ProductDescription><CustPOLineNo>1</CustPOLineNo><SerialNo>SN: FLM29430SG6</SerialNo><SerialNo>SN: FLM29443SXX</SerialNo></Item><Item lineNumber="2"><ShipQuantity>2</ShipQuantity><UnitPrice>273.9700</UnitPrice><SynnexPartNumber>CSC-NXK-MEM-16GB</SynnexPartNumber><ManuafacturerPartNumber>NXK-MEM-16GB</ManuafacturerPartNumber><SKU>5816328</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Additional memory of 16GB for Nexus Switches</ProductDescription><CustPOLineNo>10</CustPOLineNo><SerialNo>SN: K0H6020540143DC3B0</SerialNo><SerialNo>SN: K0H6020540143DCD78</SerialNo></Item></Items><Summary><TotalInvoiceAmount>14,264.98</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>0.00</Rebate><Freight>157.0930</Freight><TotalWeight>63.60</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0.003</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-02-03</InvoiceDate><InvoiceNumber>170746375</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-02-03</ShipDate><InternalReferenceNumber>38854425</InternalReferenceNumber><Tracking><TrackNumber>499143345782</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-MODE-NXOS</SynnexPartNumber><ManuafacturerPartNumber>MODE-NXOS</ManuafacturerPartNumber><SKU>5765057</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Mode selection between ACI and NXOS</ProductDescription><CustPOLineNo>3</CustPOLineNo></Item><Item lineNumber="2"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-NXOS-CS-10.5.3F</SynnexPartNumber><ManuafacturerPartNumber>NXOS-CS-10.5.3F</ManuafacturerPartNumber><SKU>14729742</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Nexus 9300, 9500, 9800 NX-OS SW 10.5.3 (64bit) Cisco Silicon</ProductDescription><CustPOLineNo>4</CustPOLineNo></Item><Item lineNumber="3"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-DCN-OTHER</SynnexPartNumber><ManuafacturerPartNumber>DCN-OTHER</ManuafacturerPartNumber><SKU>14411410</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Select if this product will NOT be used for AI Applications</ProductDescription><CustPOLineNo>5</CustPOLineNo></Item><Item lineNumber="4"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-C1-SUBS-OPTOUT</SynnexPartNumber><ManuafacturerPartNumber>C1-SUBS-OPTOUT</ManuafacturerPartNumber><SKU>5352778</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>OPT OUT PID FOR C1 ADV Subscription</ProductDescription><CustPOLineNo>6</CustPOLineNo></Item><Item lineNumber="5"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-NXK-AF-PE</SynnexPartNumber><ManuafacturerPartNumber>NXK-AF-PE</ManuafacturerPartNumber><SKU>6314195</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Dummy PID for Airflow Selection Port-side Exhaust</ProductDescription><CustPOLineNo>7</CustPOLineNo></Item><Item lineNumber="6"><ShipQuantity>2</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-NXK-ACC-KIT-1RU</SynnexPartNumber><ManuafacturerPartNumber>NXK-ACC-KIT-1RU</ManuafacturerPartNumber><SKU>5482547</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Nexus 3K/9K Fixed Accessory Kit,  1RU front and rear removal</ProductDescription><CustPOLineNo>8</CustPOLineNo></Item><Item lineNumber="7"><ShipQuantity>8</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-NXA-FAN-35CFM-PE</SynnexPartNumber><ManuafacturerPartNumber>NXA-FAN-35CFM-PE</ManuafacturerPartNumber><SKU>11491801</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Nexus Fan, 35CFM, port side exhaust airflow</ProductDescription><CustPOLineNo>9</CustPOLineNo><SerialNo>SN: NID2934X1B2</SerialNo><SerialNo>SN: NID2934X1B6</SerialNo><SerialNo>SN: NID2934X1B7</SerialNo><SerialNo>SN: NID2934X1B8</SerialNo><SerialNo>SN: NID2934X2BU</SerialNo><SerialNo>SN: NID2934X2BV</SerialNo><SerialNo>SN: NID2934X2BZ</SerialNo><SerialNo>SN: NID2934X2C3</SerialNo></Item><Item lineNumber="8"><ShipQuantity>4</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-NXA-PAC-650W-PE</SynnexPartNumber><ManuafacturerPartNumber>NXA-PAC-650W-PE</ManuafacturerPartNumber><SKU>11209937</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Nexus NEBs AC 650W PSU -  Port Side Exhaust</ProductDescription><CustPOLineNo>11</CustPOLineNo><SerialNo>SN: LIT2943AV9F</SerialNo><SerialNo>SN: LIT2943AV9T</SerialNo><SerialNo>SN: LIT2943AVUU</SerialNo><SerialNo>SN: LIT2943AWAG</SerialNo></Item><Item lineNumber="9"><ShipQuantity>4</ShipQuantity><UnitPrice>0.0000</UnitPrice><SynnexPartNumber>CSC-CAB-9K12A-NA</SynnexPartNumber><ManuafacturerPartNumber>CAB-9K12A-NA</ManuafacturerPartNumber><SKU>10130140</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>Power Cord, 125VAC 13A NEMA 5-15 Plug, North America</ProductDescription><CustPOLineNo>12</CustPOLineNo></Item></Items><Summary><TotalInvoiceAmount>0.00</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>0.00</Rebate><Freight>0.0000</Freight><TotalWeight>9.12</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-02-03</InvoiceDate><InvoiceNumber>170740112</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-02-03</ShipDate><InternalReferenceNumber>38854425</InternalReferenceNumber><Tracking><TrackNumber>499143329661,499143329650,499143329672</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>8</ShipQuantity><UnitPrice>53.7900</UnitPrice><SynnexPartNumber>CSC-SFP-H10GB-CU1-5M=</SynnexPartNumber><ManuafacturerPartNumber>SFP-H10GB-CU1-5M=</ManuafacturerPartNumber><SKU>10399630</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658525506</UPCCode><ProductDescription>10GBASE-CU SFP+ Cable 1.5 Meter</ProductDescription><CustPOLineNo>13</CustPOLineNo><SerialNo>SN: JPC2929008F</SerialNo><SerialNo>SN: JPC2929008G</SerialNo><SerialNo>SN: JPC292900JM</SerialNo><SerialNo>SN: JPC292900JQ</SerialNo><SerialNo>SN: JPC292900JR</SerialNo><SerialNo>SN: JPC292900LN</SerialNo><SerialNo>SN: JPC292900T3</SerialNo><SerialNo>SN: JPC292900TJ</SerialNo></Item><Item lineNumber="2"><ShipQuantity>16</ShipQuantity><UnitPrice>53.7900</UnitPrice><SynnexPartNumber>CSC-SFP-H10GB-CU1-5M=</SynnexPartNumber><ManuafacturerPartNumber>SFP-H10GB-CU1-5M=</ManuafacturerPartNumber><SKU>10399630</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658525506</UPCCode><ProductDescription>10GBASE-CU SFP+ Cable 1.5 Meter</ProductDescription><CustPOLineNo>14</CustPOLineNo><SerialNo>SN: JPC2929008H</SerialNo><SerialNo>SN: JPC2929008K</SerialNo><SerialNo>SN: JPC292900L9</SerialNo><SerialNo>SN: JPC292900LB</SerialNo><SerialNo>SN: JPC292900LC</SerialNo><SerialNo>SN: JPC292900LD</SerialNo><SerialNo>SN: JPC292900LE</SerialNo><SerialNo>SN: JPC292900LF</SerialNo><SerialNo>SN: JPC292900LH</SerialNo><SerialNo>SN: JPC292900LJ</SerialNo><SerialNo>SN: JPC292900RF</SerialNo><SerialNo>SN: JPC292900RG</SerialNo><SerialNo>SN: JPC292900RJ</SerialNo><SerialNo>SN: JPC292900RK</SerialNo><SerialNo>SN: JPC292900RL</SerialNo><SerialNo>SN: JPC292900RM</SerialNo></Item><Item lineNumber="3"><ShipQuantity>9</ShipQuantity><UnitPrice>53.7900</UnitPrice><SynnexPartNumber>CSC-SFP-H10GB-CU1-5M=</SynnexPartNumber><ManuafacturerPartNumber>SFP-H10GB-CU1-5M=</ManuafacturerPartNumber><SKU>10399630</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658525506</UPCCode><ProductDescription>10GBASE-CU SFP+ Cable 1.5 Meter</ProductDescription><CustPOLineNo>15</CustPOLineNo><SerialNo>SN: JPC292900S9</SerialNo><SerialNo>SN: JPC292900T9</SerialNo><SerialNo>SN: JPC292900TB</SerialNo><SerialNo>SN: JPC292900TC</SerialNo><SerialNo>SN: JPC292900TD</SerialNo><SerialNo>SN: JPC292900TE</SerialNo><SerialNo>SN: JPC292900TF</SerialNo><SerialNo>SN: JPC292900TG</SerialNo><SerialNo>SN: JPC292900TH</SerialNo></Item></Items><Summary><TotalInvoiceAmount>1,775.07</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>0.00</Rebate><Freight>19.5470</Freight><TotalWeight>13.20</TotalWeight><SalesTax>0.00</SalesTax><Shipping>-0.003</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-01-15</InvoiceDate><InvoiceNumber>169811617</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-01-15</ShipDate><InternalReferenceNumber>157389979</InternalReferenceNumber><Tracking><TrackNumber>497471090462</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>3</ShipQuantity><UnitPrice>53.7900</UnitPrice><SynnexPartNumber>CSC-SFP-H10GB-CU1-5M=</SynnexPartNumber><ManuafacturerPartNumber>SFP-H10GB-CU1-5M=</ManuafacturerPartNumber><SKU>10399630</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658525506</UPCCode><ProductDescription>10GBASE-CU SFP+ Cable 1.5 Meter</ProductDescription><CustPOLineNo>18</CustPOLineNo><SerialNo>SN: JPC2918000Y</SerialNo><SerialNo>SN: JPC2918000Z</SerialNo><SerialNo>SN: JPC29180072</SerialNo></Item></Items><Summary><TotalInvoiceAmount>161.37</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>-72.63</Rebate><Freight>12.6900</Freight><TotalWeight>1.00</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-01-15</InvoiceDate><InvoiceNumber>169811618</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-01-15</ShipDate><InternalReferenceNumber>157389979</InternalReferenceNumber><Tracking><TrackNumber>497518980663</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>2</ShipQuantity><UnitPrice>68.3900</UnitPrice><SynnexPartNumber>CSC-QSFP-100G-CU1M=</SynnexPartNumber><ManuafacturerPartNumber>QSFP-100G-CU1M=</ManuafacturerPartNumber><SKU>11362444</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658836602</UPCCode><ProductDescription>100GBASE-CR4 Passive Copper Cable, 1m</ProductDescription><CustPOLineNo>13</CustPOLineNo><SerialNo>SN: APF293801GV</SerialNo><SerialNo>SN: APF293801H5</SerialNo></Item><Item lineNumber="2"><ShipQuantity>5</ShipQuantity><UnitPrice>126.7100</UnitPrice><SynnexPartNumber>CSC-GLC-TE=</SynnexPartNumber><ManuafacturerPartNumber>GLC-TE=</ManuafacturerPartNumber><SKU>11252455</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340932</UPCCode><ProductDescription>1000BASE-T SFP transceiver module for Category 5 copper wire</ProductDescription><CustPOLineNo>14</CustPOLineNo><SerialNo>SN: ACW29191SCN</SerialNo><SerialNo>SN: ACW29191SCV</SerialNo><SerialNo>SN: ACW29191SM1</SerialNo><SerialNo>SN: ACW29191T6X</SerialNo><SerialNo>SN: ACW29191T74</SerialNo></Item><Item lineNumber="3"><ShipQuantity>1</ShipQuantity><UnitPrice>222.5600</UnitPrice><SynnexPartNumber>CSC-SFP-10G-SR-S=</SynnexPartNumber><ManuafacturerPartNumber>SFP-10G-SR-S=</ManuafacturerPartNumber><SKU>11111952</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658782466</UPCCode><ProductDescription>10GBASE-SR SFP Module, Enterprise-Class</ProductDescription><CustPOLineNo>17</CustPOLineNo><SerialNo>SN: SFNS29421BCM</SerialNo></Item><Item lineNumber="4"><ShipQuantity>5</ShipQuantity><UnitPrice>222.5600</UnitPrice><SynnexPartNumber>CSC-SFP-10G-SR-S=</SynnexPartNumber><ManuafacturerPartNumber>SFP-10G-SR-S=</ManuafacturerPartNumber><SKU>11111952</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658782466</UPCCode><ProductDescription>10GBASE-SR SFP Module, Enterprise-Class</ProductDescription><CustPOLineNo>20</CustPOLineNo><SerialNo>SN: SACW2920120Y</SerialNo><SerialNo>SN: SACW2920140X</SerialNo><SerialNo>SN: SFNS29421B9A</SerialNo><SerialNo>SN: SFNS29421BHU</SerialNo><SerialNo>SN: SFNS29421BWA</SerialNo></Item><Item lineNumber="5"><ShipQuantity>1</ShipQuantity><UnitPrice>126.7100</UnitPrice><SynnexPartNumber>CSC-GLC-TE=</SynnexPartNumber><ManuafacturerPartNumber>GLC-TE=</ManuafacturerPartNumber><SKU>11252455</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340932</UPCCode><ProductDescription>1000BASE-T SFP transceiver module for Category 5 copper wire</ProductDescription><CustPOLineNo>21</CustPOLineNo><SerialNo>SN: ACW29191SD4</SerialNo></Item><Item lineNumber="6"><ShipQuantity>4</ShipQuantity><UnitPrice>222.5600</UnitPrice><SynnexPartNumber>CSC-SFP-10G-SR-S=</SynnexPartNumber><ManuafacturerPartNumber>SFP-10G-SR-S=</ManuafacturerPartNumber><SKU>11111952</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658782466</UPCCode><ProductDescription>10GBASE-SR SFP Module, Enterprise-Class</ProductDescription><CustPOLineNo>23</CustPOLineNo><SerialNo>SN: SFNS29420JRK</SerialNo><SerialNo>SN: SFNS29421B7L</SerialNo><SerialNo>SN: SOPM29460445</SerialNo><SerialNo>SN: SOPM294605NJ</SerialNo></Item><Item lineNumber="7"><ShipQuantity>1</ShipQuantity><UnitPrice>126.7100</UnitPrice><SynnexPartNumber>CSC-GLC-TE=</SynnexPartNumber><ManuafacturerPartNumber>GLC-TE=</ManuafacturerPartNumber><SKU>11252455</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340932</UPCCode><ProductDescription>1000BASE-T SFP transceiver module for Category 5 copper wire</ProductDescription><CustPOLineNo>24</CustPOLineNo><SerialNo>SN: ACW29191SM4</SerialNo></Item><Item lineNumber="8"><ShipQuantity>3</ShipQuantity><UnitPrice>222.5600</UnitPrice><SynnexPartNumber>CSC-SFP-10G-SR-S=</SynnexPartNumber><ManuafacturerPartNumber>SFP-10G-SR-S=</ManuafacturerPartNumber><SKU>11111952</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658782466</UPCCode><ProductDescription>10GBASE-SR SFP Module, Enterprise-Class</ProductDescription><CustPOLineNo>26</CustPOLineNo><SerialNo>SN: SOPM294524HQ</SerialNo><SerialNo>SN: SOPM294605N0</SerialNo><SerialNo>SN: SOPM294605RG</SerialNo></Item><Item lineNumber="9"><ShipQuantity>1</ShipQuantity><UnitPrice>126.7100</UnitPrice><SynnexPartNumber>CSC-GLC-TE=</SynnexPartNumber><ManuafacturerPartNumber>GLC-TE=</ManuafacturerPartNumber><SKU>11252455</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340932</UPCCode><ProductDescription>1000BASE-T SFP transceiver module for Category 5 copper wire</ProductDescription><CustPOLineNo>27</CustPOLineNo><SerialNo>SN: ACW29191U77</SerialNo></Item></Items><Summary><TotalInvoiceAmount>4,043.74</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>-5870.19</Rebate><Freight>31.3400</Freight><TotalWeight>2.00</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-01-15</InvoiceDate><InvoiceNumber>169811619</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>FG</ShipMethodCode><ShipMethodDesc>FedEx Ground</ShipMethodDesc><ShipDate>2026-01-15</ShipDate><InternalReferenceNumber>157389979</InternalReferenceNumber><Tracking><TrackNumber>500218809813</TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>8</ShipQuantity><UnitPrice>190.0400</UnitPrice><SynnexPartNumber>CSC-GLC-SX-MMD=</SynnexPartNumber><ManuafacturerPartNumber>GLC-SX-MMD=</ManuafacturerPartNumber><SKU>10453536</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340895</UPCCode><ProductDescription>1000BASE-SX SFP transceiver module, MMF, 850nm, DOM</ProductDescription><CustPOLineNo>15</CustPOLineNo><SerialNo>SN: SACW29370HYL</SerialNo><SerialNo>SN: SACW29370NR0</SerialNo><SerialNo>SN: SACW29370NRB</SerialNo><SerialNo>SN: SACW29370TNA</SerialNo><SerialNo>SN: SACW29370TQU</SerialNo><SerialNo>SN: SACW29370U0D</SerialNo><SerialNo>SN: SOPM29451RSR</SerialNo><SerialNo>SN: SOPM29451RXU</SerialNo></Item><Item lineNumber="2"><ShipQuantity>2</ShipQuantity><UnitPrice>388.9600</UnitPrice><SynnexPartNumber>CSC-GLC-LH-SMD=</SynnexPartNumber><ManuafacturerPartNumber>GLC-LH-SMD=</ManuafacturerPartNumber><SKU>10129403</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><UPCCode>882658340901</UPCCode><ProductDescription>1000BASE-LX/LH SFP transceiver module, MMF/SMF, 1310nm, DOM</ProductDescription><CustPOLineNo>16</CustPOLineNo><SerialNo>SN: SFNS29410WNR</SerialNo><SerialNo>SN: SFNS294110UJ</SerialNo></Item></Items><Summary><TotalInvoiceAmount>2,298.24</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>-2096.52</Rebate><Freight>22.9500</Freight><TotalWeight>1.00</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0</Shipping></Summary></Invoice><Invoice><InvoiceDate>2026-02-03</InvoiceDate><InvoiceNumber>170745206</InvoiceNumber><OrderType>1</OrderType><ShipTo><AddressName>OPKO Health, Inc.</AddressName><AddressLine1>4400 BISCAYNE BLVD.</AddressLine1><AddressLine2> </AddressLine2><City>MIAMI</City><State>FL</State><Zip>33137</Zip><Country>US</Country></ShipTo><BillTo><AddressName1>CUMBERLAND GROUP, LLC</AddressName1><AddressLine1>300 GALLERIA PKWY, SUITE 1600</AddressLine1><City>ATLANTA</City><State>GA</State><Zip>30339</Zip><Country>US</Country></BillTo><Discount>0.00</Discount><DiscountDays>0</DiscountDays><PaymentTermDays>60</PaymentTermDays><PaymentTermDesc>NET 60 DAYS</PaymentTermDesc><ShipMethodCode>EDEL</ShipMethodCode><ShipMethodDesc>Electronic Delivery (Email)</ShipMethodDesc><ShipDate>2026-02-03</ShipDate><InternalReferenceNumber>38854425</InternalReferenceNumber><Tracking><TrackNumber> </TrackNumber></Tracking><Items><Item lineNumber="1"><ShipQuantity>2</ShipQuantity><UnitPrice>4,881.8000</UnitPrice><SynnexPartNumber>CSC-CON-SNTP-N9KC93X3</SynnexPartNumber><ManuafacturerPartNumber>CON-SNTP-N9KC93X3</ManuafacturerPartNumber><SKU>6204416</SKU><VendorNumber>64956</VendorNumber><VendorName>CISCO SYSTEMS</VendorName><ProductDescription>SNTC-24X7X4 NEXUS 9300 48P 1/10/25G, 6P 40/100G, MAC</ProductDescription><CustPOLineNo>2</CustPOLineNo></Item></Items><Summary><TotalInvoiceAmount>9,763.60</TotalInvoiceAmount><ExpenseTotal>0.00</ExpenseTotal><MinOrderFee>0</MinOrderFee><Rebate>0.00</Rebate><Freight>0.0000</Freight><TotalWeight>0.00</TotalWeight><SalesTax>0.00</SalesTax><Shipping>0</Shipping></Summary></Invoice></InvoiceResponse></SynnexB2B>'
    };

    return SynnexApiAdapter;
});
