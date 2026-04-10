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
 * Script Name: VC Services | Item Match Library
 *
 * @author brianf@nscatalyst.com
 * @description Item-matching helper between vendor lines and NetSuite items for Services flows.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-25   brianf        Changed isItemMapped to return false instead of throwing when no mapped names exist for the item
 * 2026-03-20   brianf        Removed all inline comments from file; preserved JSDoc and copyright header
 * 2026-03-18   brianf        Added availableQtyType support in matchVendorLines to select FULL, FULFILLABLE, or BILLABLE quantity
 *                              basis per caller
 * 2026-03-14   brianf        Normalized shared library imports to explicit .js paths for ctc_lib_utils and ctc_lib_error while
 *                              keeping ctc_lib_return out of this module
 * 2026-03-03   brianf        Fixed util.extend bug in matchVendorLines; corrected all JSDoc @returns; removed dead ERROR_LIST,
 *                              dead var assignments, and double-inits; hoisted fetchItemAltNames/fetchItemMapping outside
 *                              forEach; added matchVendorLines JSDoc and section comments
 * 2026-03-02   brianf        Fixed early-return inconsistencies in fetchItemMapping/fetchItemAltNames; fixed partial-match
 *                              guard to allow re-matching when AVAILQTY > 0
 * 2026-02-27   brianf        Code formatting improvements; consolidated multi-line statements
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var LogTitle = 'SVC:ItemMatching';

    var ns_search = require('N/search'),
        ns_util = require('N/util'),
        ns_record = require('N/record');

    var vclib_util = require('./lib/ctc_lib_utils.js'),
        vclib_error = require('./lib/ctc_lib_error.js'),
        vclib_constant = require('./lib/ctc_lib_constants');

    var vcs_configLib = require('./ctc_svclib_configlib'),
        vcs_recordLib = require('./ctc_svclib_records');

    var Current = {};

    var ERROR_LIST = {
        NO_ALT_NAMES_TO_FETCH: {
            code: 'NO_ALT_NAMES_TO_FETCH',
            message: 'No alternative names to fetch for this line item.',
            level: vclib_error.ErrorLevel.WARNING
        },
        NO_ALT_NAMES: {
            code: 'NO_ALT_NAMES',
            message: 'No alternative names found for this line item.',
            level: vclib_error.ErrorLevel.WARNING
        },
        NO_MAPPED_NAMES: {
            code: 'NO_MAPPED_NAMES',
            message: 'No mapped items to fetch for this line item.',
            level: vclib_error.ErrorLevel.WARNING
        }
    };

    var Helper = {
        /**
         * @function addSOLines
         * @description Loads SO lines from Sales Order and links them to PO lines
         * @param {Object} option - Configuration object
         * @param {Object} option.poRec - Purchase Order record (REQUIRED)
         * @param {number} [option.poId] - Purchase Order internal ID
         * @param {Object} [option.soRec] - Sales Order record
         * @param {number} [option.soId] - Sales Order internal ID
         * @param {Array<Object>} [option.soLines] - Existing SO line objects to extend
         * @param {Array<Object>} [option.poLines] - PO line objects for cross-referencing
         * @returns {Array<Object>|false} Array of SO line objects with extended properties, or false on error
         */
        addSOLines: function (option) {
            var logTitle = [LogTitle, 'addSOLines'].join('::'),
                returnValue = false;

            try {
                if (!option.poRec) throw { code: 'MISSING_PARAMETER', details: 'poRec' };
                var poRec = option.poRec;

                if (vclib_util.isEmpty(option.soRec)) {
                    option.soId = poRec.getValue('createdfrom');
                    if (!option.soId) {
                        return [];
                    }
                    option.soRec = vcs_recordLib.load({
                        type: ns_record.Type.SALES_ORDER,
                        id: option.soId
                    });
                }

                var soLines = option.soLines,
                    extendedSOLines = vcs_recordLib.extractLineValues({
                        record: option.soRec,
                        additionalColumns: Helper.getLineColumns(option)
                    });

                if (vclib_util.isEmpty(soLines)) option.soLines = extendedSOLines;
                else
                    option.soLines.forEach(function (soLine) {
                        var matchedLine = extendedSOLines.filter(function (extendedSOLine) {
                            return extendedSOLine.line == soLine.line;
                        });
                        if (matchedLine.length) ns_util.extend(soLine, matchedLine[0]);
                    });

                if (!vclib_util.isEmpty(option.soLines) && !vclib_util.isEmpty(option.poLines)) {
                    var soLinesFiltered = option.soLines.filter(function (soLine) {
                        return soLine.createdpo == option.poId;
                    });

                    option.poLines.forEach(function (poLine) {
                        var matchedLine = soLinesFiltered.filter(function (soLine, idx) {
                            return idx == poLine.line - 1;
                        });
                        if (matchedLine.length) poLine.SOLINE = matchedLine[0];
                        return true;
                    });
                }

                returnValue = option.soLines;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },
        /**
         * @function addPOLines
         * @description Loads and extends PO lines with additional columns from the Purchase Order
         * @param {Object} option - Configuration object
         * @param {Object} option.poRec - Purchase Order record (REQUIRED)
         * @param {Array<Object>} [option.poLines] - Existing PO line objects to extend
         * @returns {Array<Object>|false} Array of extended PO line objects, or false on error
         */
        addPOLines: function (option) {
            var logTitle = [LogTitle, 'addPOLines'].join('::'),
                returnValue = false;

            try {
                if (!option.poRec) throw { code: 'MISSING_PARAMETER', details: 'poRec' };

                var poLines = option.poLines,
                    extendedPOLines = vcs_recordLib.extractLineValues({
                        record: option.poRec,
                        additionalColumns: Helper.getLineColumns(option)
                    });

                if (vclib_util.isEmpty(poLines)) option.poLines = extendedPOLines;
                else
                    option.poLines.forEach(function (poLine) {
                        var matchedLine = extendedPOLines.filter(function (extendedPOLine) {
                            return extendedPOLine.line == poLine.line;
                        });
                        if (matchedLine.length) ns_util.extend(poLine, matchedLine[0]);
                    });

                returnValue = option.poLines;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * @function getLineColumns
         * @description Builds the list of additional columns to extract from order lines based on configuration
         * @param {Object} option - Configuration object
         * @param {Object} [option.mainConfig] - Main configuration object
         * @param {Object} [option.vendorConfig] - Vendor configuration object
         * @returns {Array<string>|false} Array of field IDs to extract, or false on error
         */
        getLineColumns: function (option) {
            var logTitle = [LogTitle, 'getLineColumns'].join('::'),
                returnValue = false;

            try {
                var MainCFG = option.mainConfig,
                    VendorCFG = option.vendorConfig;

                var addlPOFields = [
                    'orderline',
                    'poline',
                    'createdpo',
                    vclib_constant.GLOBAL.ITEM_ID_LOOKUP_COL,
                    vclib_constant.GLOBAL.VENDOR_SKU_LOOKUP_COL,
                    vclib_constant.FIELD.TRANSACTION.DH_MPN,
                    vclib_constant.FIELD.TRANSACTION.DELL_QUOTE_NO,
                    vclib_constant.GLOBAL.INCLUDE_ITEM_MAPPING_LOOKUP_KEY
                ];

                if (VendorCFG && VendorCFG.itemColumnIdToMatch) {
                    addlPOFields.push(VendorCFG.itemColumnIdToMatch);
                } else if (MainCFG && MainCFG.itemColumnIdToMatch) {
                    addlPOFields.push(MainCFG.itemColumnIdToMatch);
                }

                if (VendorCFG && VendorCFG.itemMPNColumnIdToMatch) {
                    addlPOFields.push(VendorCFG.itemMPNColumnIdToMatch);
                } else if (MainCFG && MainCFG.itemMPNColumnIdToMatch) {
                    addlPOFields.push(MainCFG.itemMPNColumnIdToMatch);
                }

                returnValue = addlPOFields;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * @function prepareOrderLines
         * @description Initializes order line objects with tracking fields and utility methods required for matching operations
         * @param {Array<Object>} orderLines - Array of order line objects to prepare (REQUIRED)
         * @returns {Array<Object>|false} Prepared order lines with matching metadata, or false on error
         */
        prepareOrderLines: function (orderLines) {
            var logTitle = [LogTitle, 'prepOrderLines'].join('::'),
                returnValue = false;

            try {
                if (vclib_util.isEmpty(orderLines))
                    throw { code: 'MISSING_PARAMETER', details: 'orderLines' };

                orderLines.forEach(function (orderLine) {
                    if (vclib_util.isEmpty(orderLine.AVAILQTY))
                        orderLine.AVAILQTY = orderLine.quantity || orderLine.QUANTITY || 0;

                    orderLine.APPLIEDRATE = orderLine.rate || orderLine.unitprice || 0;

                    orderLine.APPLIEDQTY = 0;
                    orderLine.BILLEDQTY = 0;
                    orderLine.FFQTY = 0;

                    orderLine.AVAILBILLQTY = orderLine.quantity - (orderLine.quantitybilled || 0);
                    orderLine.AVAILFFQTY = orderLine.quantity - (orderLine.quantityreceived || 0);
                    orderLine.BILLEDQTY = orderLine.quantitybilled || 0;
                    orderLine.FFQTY = orderLine.quantityreceived || 0;

                    orderLine.MATCHING = [];
                    orderLine.MATCHED_BY = null;
                    orderLine.HAS_MATCH = false;

                    if (
                        !vclib_util.isEmpty(orderLine.SERIALS) &&
                        ns_util.isString(orderLine.SERIALS)
                    ) {
                        orderLine.SERIALS = orderLine.SERIALS.split(',').map(function (serial) {
                            return serial.trim();
                        });
                    }

                    orderLine.UseQuantity = function (qty) {
                        this.APPLIEDQTY += qty;
                        this.AVAILQTY -= qty;
                        return { APPLIEDQTY: qty };
                    };
                });

                orderLines.sort(function (a, b) {
                    return b.AVAILQTY - a.AVAILQTY;
                });

                returnValue = orderLines;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }
            return returnValue;
        },

        /**
         * @function resolveAvailableQty
         * @description Resolves which available quantity basis to use for a PO line during matching
         * @param {Object} option - Configuration object
         * @param {Object} option.orderLine - Order line object with quantity fields
         * @param {string} [option.availableQtyType='FULL'] - FULL | FULFILLABLE | BILLABLE
         * @returns {number} Available quantity resolved from selected quantity basis
         */
        resolveAvailableQty: function (option) {
            var logTitle = [LogTitle, 'resolveAvailableQty'].join('::'),
                returnValue = 0;

            option = option || {};

            try {
                var orderLine = option.orderLine || {},
                    selectedType = (option.availableQtyType || 'FULL').toString().toUpperCase();

                returnValue =
                    selectedType == 'BILLABLE'
                        ? orderLine.AVAILBILLQTY
                        : selectedType == 'FULFILLABLE'
                          ? orderLine.AVAILFFQTY
                          : orderLine.AVAILQTY;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = 0;
            }

            return returnValue;
        }
    };

    var LibItemMatching = {
        /**
         * Matches vendor lines to NetSuite order lines (PO/SO/FF/VB) using item, MPN, and mapping logic.
         *
         * This function attempts to match each vendor line to the appropriate NetSuite order line(s) by comparing item names,
         * manufacturer part numbers, and configured item mappings. It supports matching for Purchase Orders (PO), Sales Orders (SO),
         * Item Receipts (FF), and Vendor Bills (VB). The function will extend the provided line objects with matching metadata and
         * utility methods for quantity tracking.
         *
         * @param {Object} option - Configuration object
         * @param {Array<Object>} option.vendorLines - Array of vendor line objects to match (REQUIRED)
         * @param {Object} [option.mainConfig] - Main configuration object (optional, will be loaded if not provided)
         * @param {Object} [option.vendorConfig] - Vendor configuration object (optional, will be loaded if not provided)
         * @param {string} [option.forRecordType] - NetSuite record type context (e.g., 'purchaseorder', 'itemreceipt')
         * @param {Object} [option.poRec] - NetSuite Purchase Order record object
         * @param {number|string} [option.poId] - NetSuite Purchase Order internal ID
         * @param {Array<Object>} [option.poLines] - Array of PO line objects (optional, will be extracted if not provided)
         * @param {Object} [option.soRec] - NetSuite Sales Order record object
         * @param {number|string} [option.soId] - NetSuite Sales Order internal ID
         * @param {Array<Object>} [option.soLines] - Array of SO line objects (optional)
         * @param {Object} [option.ffRec] - NetSuite Item Receipt record object
         * @param {Array<Object>} [option.ffLines] - Array of Item Receipt line objects (optional)
         * @param {Object} [option.vbRec] - NetSuite Vendor Bill record object
         * @param {Array<Object>} [option.vbLines] - Array of Vendor Bill line objects (optional)
         * @returns {Array<Object>|false} Array of vendor line objects, each extended with a MATCHING array of
         *   matched PO lines and tracking fields (APPLIEDQTY, AVAILQTY, ITEM_LINK, etc.), or false on error.
         */
        matchOrderLines: function (option) {
            var logTitle = [LogTitle, 'matchOrderLines'].join('::'),
                returnValue = false;

            option = option || {};
            try {
                if (!option.poId) {
                    if (!option.poRec || !option.poRec.id)
                        throw { code: 'MISSING_PARAMETER', details: 'poId or poRec with valid id' };

                    option.poId = option.poRec.id;
                }

                if (!option.vendorLines)
                    throw { code: 'MISSING_PARAMETER', details: 'vendorLines' };

                var MainCFG = option.mainConfig || vcs_configLib.mainConfig() || {},
                    VendorCFG =
                        option.vendorConfig || vcs_configLib.vendorConfig({ poId: option.poId });

                if (!option.mainConfig) option.mainConfig = MainCFG;
                if (!option.vendorConfig) option.vendorConfig = VendorCFG;

                if (vclib_util.isEmpty(option.poRec)) {
                    option.poRec = vcs_recordLib.load({
                        type: ns_record.Type.PURCHASE_ORDER,
                        id: option.poId
                    });
                }

                option.poLines = Helper.addPOLines(option);

                option.soLines = Helper.addSOLines(option);

                if (!vclib_util.isEmpty(option.ffLines)) {
                    var forRecordType = option.forRecordType,
                        poId = option.poId;
                    option.poLines.forEach(function (poLine) {
                        var matchedLine = option.ffLines.filter(function (ffLine) {
                            var returnValue = false;

                            if (forRecordType && forRecordType == ns_record.Type.ITEM_RECEIPT) {
                                returnValue =
                                    ffLine.orderdoc &&
                                    ffLine.orderdoc == poId &&
                                    ffLine.orderline == poLine.line;
                            } else {
                                returnValue =
                                    ffLine.createdpo == poId && poLine.line == ffLine.poline;
                            }

                            return returnValue;
                        });
                        if (matchedLine.length) poLine.FFLINE = matchedLine[0];
                        return true;
                    });
                }

                var poLines = option.poLines || [],
                    vendorLines = option.vendorLines || [];

                poLines.forEach(function (poLine) {
                    if (vclib_util.isEmpty(poLine.AVAILQTY)) poLine.AVAILQTY = poLine.quantity;

                    poLine.APPLIEDRATE = poLine.rate || poLine.unitprice || 0;

                    poLine.APPLIEDQTY = 0;

                    poLine.AVAILBILLQTY = poLine.quantity - (poLine.quantitybilled || 0);
                    poLine.AVAILFFQTY = poLine.quantity - (poLine.quantityreceived || 0);
                    poLine.BILLEDQTY = poLine.quantitybilled || 0;
                    poLine.FFQTY = poLine.quantityreceived || 0;

                    poLine.UseQuantity = function (qty) {
                        this.APPLIEDQTY += qty;
                        this.AVAILQTY -= qty;
                        return { APPLIEDQTY: qty };
                    };
                });
                poLines.sort(function (a, b) {
                    return b.AVAILQTY - a.AVAILQTY;
                });

                vendorLines.forEach(function (vendorLine) {
                    if (!vendorLine.MATCHING) {
                        vendorLine.MATCHING = [];
                        vendorLine.APPLIEDQTY = 0;

                        vendorLine.HAS_MATCH = false;
                        vendorLine.MATCHED_BY = null;
                    }

                    if (vclib_util.isEmpty(vendorLine.AVAILQTY))
                        vendorLine.AVAILQTY = vendorLine.QUANTITY || vendorLine.ship_qty;

                    vendorLine.APPLIEDRATE = vclib_util.forceFloat(
                        vendorLine.unitprice || vendorLine.line_price
                    );

                    if (vendorLine.SERIALS) {
                        if (ns_util.isString(vendorLine.SERIALS))
                            vendorLine.SERIALS = vendorLine.SERIALS.split(',');
                        vendorLine.SERIALS.sort();
                    }

                    vendorLine.UseQuantity = function (qty) {
                        this.APPLIEDQTY += qty;
                        this.AVAILQTY -= qty;
                        return { APPLIEDQTY: qty };
                    };
                });
                vendorLines.sort(function (a, b) {
                    return b.AVAILQTY - a.AVAILQTY;
                });

                var listItemAltNames = LibItemMatching.fetchItemAltNames({
                    orderLines: poLines,
                    mainConfig: MainCFG,
                    vendorConfig: VendorCFG
                });
                var listMappedItems = LibItemMatching.fetchItemMapping({ orderLines: poLines });

                vendorLines.forEach(function (vendorLine) {
                    if (vendorLine.MATCHING && vendorLine.MATCHING.length && !vendorLine.AVAILQTY) {
                        vendorLine.MATCHING.forEach(function (matchedPOLine) {
                            var matchingPOLines = poLines.filter(function (poLine) {
                                return poLine.line == matchedPOLine.line;
                            });
                            if (matchingPOLines.length) {
                                matchedPOLine.FFLINE = matchingPOLines[0].FFLINE;
                                matchedPOLine.SOLINE = matchingPOLines[0].SOLINE;
                            }
                            return true;
                        });
                        return true;
                    }

                    var MatchedLines = {
                        byItem: poLines.filter(function (poLine) {
                            return LibItemMatching.isItemMatched({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                mainConfig: MainCFG,
                                vendorConfig: VendorCFG
                            });
                        })
                    };

                    if (!MatchedLines.byItem.length) {
                        MatchedLines.byItem = poLines.filter(function (poLine) {
                            return LibItemMatching.isItemAltMatched({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                listAltNames: listItemAltNames,
                                mainConfig: MainCFG,
                                vendorConfig: VendorCFG
                            });
                        });
                    }

                    if (!MatchedLines.byItem.length) {
                        MatchedLines.byItem = poLines.filter(function (poLine) {
                            return LibItemMatching.isItemMapped({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                listMappedItems: listMappedItems
                            });
                        });
                    }

                    if (!MatchedLines.byItem.length) return;

                    vendorLine.ITEM_LINK = MatchedLines.byItem[0].item;

                    ns_util.extend(MatchedLines, {
                        byRateQty: MatchedLines.byItem.filter(function (poLine) {
                            return (
                                poLine.AVAILQTY == vendorLine.AVAILQTY &&
                                poLine.APPLIEDRATE == vendorLine.APPLIEDRATE
                            );
                        }),
                        byRate: MatchedLines.byItem.filter(function (poLine) {
                            return poLine.APPLIEDRATE == vendorLine.APPLIEDRATE;
                        }),
                        byQty: MatchedLines.byItem.filter(function (poLine) {
                            return poLine.AVAILQTY == vendorLine.AVAILQTY;
                        })
                    });

                    if (MatchedLines.byRateQty.length) {
                        MatchedLines.byRateQty.forEach(function (matchedLine) {
                            if (!matchedLine.AVAILQTY || !vendorLine.AVAILQTY) return;

                            var appliedLine = vendorLine.UseQuantity(matchedLine.AVAILQTY);
                            vendorLine.MATCHING.push(vclib_util.extend(matchedLine, appliedLine));
                            matchedLine.UseQuantity(appliedLine.APPLIEDQTY);
                            return true;
                        });
                    }

                    MatchedLines.byRate.forEach(function (poLine) {
                        if (!poLine.AVAILQTY || !vendorLine.AVAILQTY) return;

                        var qty = Math.min(poLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        vendorLine.MATCHING.push(vclib_util.extend(poLine, appliedLine));
                        poLine.UseQuantity(appliedLine.APPLIEDQTY);
                    });

                    MatchedLines.byQty.forEach(function (poLine) {
                        if (!poLine.AVAILQTY || !vendorLine.AVAILQTY) return;

                        var qty = Math.min(poLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        vendorLine.MATCHING.push(vclib_util.extend(poLine, appliedLine));
                        poLine.UseQuantity(appliedLine.APPLIEDQTY);
                    });

                    MatchedLines.byItem.forEach(function (poLine) {
                        if (!poLine.AVAILQTY || !vendorLine.AVAILQTY) return;

                        var qty = Math.min(poLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        vendorLine.MATCHING.push(vclib_util.extend(poLine, appliedLine));
                        poLine.UseQuantity(appliedLine.APPLIEDQTY);
                    });

                    return true;
                });

                vendorLines.sort(function (a, b) {
                    return a.line - b.line;
                });

                returnValue = vendorLines;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Matches vendor lines to NetSuite PO lines using item, MPN, and mapping logic.
         * Preferred over matchOrderLines for new call sites — uses Helper.prepareOrderLines
         * to initialize tracking fields and produces cleaner quantity-consumption tracking.
         *
         * @param {Object} option - Configuration object
         * @param {Array<Object>} option.vendorLines - Array of vendor line objects to match (REQUIRED)
         * @param {Object} [option.mainConfig] - Main configuration (will be loaded if not provided)
         * @param {Object} [option.vendorConfig] - Vendor configuration (will be loaded if not provided)
         * @param {Object} [option.poRec] - NetSuite Purchase Order record object
         * @param {number|string} [option.poId] - PO internal ID (required; or derived from poRec.id)
         * @param {Array<Object>} [option.poLines] - PO line objects (will be extracted if not provided)
         * @param {Array<Object>} [option.soLines] - SO line objects (optional; linked from PO if available)
         * @param {string} [option.availableQtyType] - Quantity basis for PO matching: FULL | FULFILLABLE | BILLABLE
         * @returns {Array<Object>|false} Array of vendor line objects each extended with a MATCHING array
         *   of matched PO lines and tracking fields, or false on error.
         */
        matchVendorLines: function (option) {
            var logTitle = [LogTitle, 'matchVendorLines'].join('::'),
                returnValue = false;

            option = option || {};

            try {
                if (!option.poId) {
                    if (!option.poRec || !option.poRec.id)
                        throw { code: 'MISSING_PARAMETER', details: 'poId or poRec with valid id' };

                    option.poId = option.poRec.id;
                }

                if (!option.vendorLines)
                    throw { code: 'MISSING_PARAMETER', details: 'vendorLines' };

                var MainCFG = option.mainConfig || vcs_configLib.mainConfig() || {},
                    VendorCFG =
                        option.vendorConfig || vcs_configLib.vendorConfig({ poId: option.poId });

                if (!option.mainConfig) option.mainConfig = MainCFG;
                if (!option.vendorConfig) option.vendorConfig = VendorCFG;

                if (vclib_util.isEmpty(option.poRec)) {
                    option.poRec = vcs_recordLib.load({
                        type: ns_record.Type.PURCHASE_ORDER,
                        id: option.poId
                    });
                }

                option.poLines = Helper.addPOLines(option);
                option.soLines = Helper.addSOLines(option);

                var poLines = Helper.prepareOrderLines(option.poLines || []),
                    vendorLines = Helper.prepareOrderLines(option.vendorLines || []);

                var listItemAltNames = LibItemMatching.fetchItemAltNames({
                    orderLines: poLines,
                    mainConfig: MainCFG,
                    vendorConfig: VendorCFG
                });
                var listMappedItems = LibItemMatching.fetchItemMapping({ orderLines: poLines });

                vendorLines.forEach(function (vendorLine) {
                    if (!vclib_util.isEmpty(vendorLine.MATCHING) && !vendorLine.AVAILQTY) {
                        vendorLine.MATCHING.forEach(function (matchedPOLine) {
                            var matchingPOLines = poLines.filter(function (poLine) {
                                return poLine.line == matchedPOLine.line;
                            });
                            if (matchingPOLines.length) {
                                matchedPOLine.FFLINE = matchingPOLines[0].FFLINE;
                                matchedPOLine.SOLINE = matchingPOLines[0].SOLINE;
                            }
                            return true;
                        });

                        return true;
                    }

                    var MatchedLines = {
                        byItem: poLines.filter(function (poLine) {
                            return LibItemMatching.isItemMatched({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                mainConfig: MainCFG,
                                vendorConfig: VendorCFG
                            });
                        })
                    };

                    if (vclib_util.isEmpty(MatchedLines.byItem)) {
                        MatchedLines.byItem = poLines.filter(function (poLine) {
                            return LibItemMatching.isItemAltMatched({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                listAltNames: listItemAltNames,
                                mainConfig: MainCFG,
                                vendorConfig: VendorCFG
                            });
                        });
                    }

                    if (vclib_util.isEmpty(MatchedLines.byItem)) {
                        MatchedLines.byItem = poLines.filter(function (poLine) {
                            return LibItemMatching.isItemMapped({
                                poLine: poLine,
                                vendorLine: vendorLine,
                                listMappedItems: listMappedItems
                            });
                        });
                    }

                    if (vclib_util.isEmpty(MatchedLines.byItem)) return;

                    vendorLine.ITEM_LINK = MatchedLines.byItem[0].item;

                    ns_util.extend(MatchedLines, {
                        byRateQty: MatchedLines.byItem.filter(function (poLine) {
                            return (
                                poLine.AVAILQTY == vendorLine.AVAILQTY &&
                                poLine.APPLIEDRATE == vendorLine.APPLIEDRATE
                            );
                        }),
                        byRate: MatchedLines.byItem.filter(function (poLine) {
                            return poLine.APPLIEDRATE == vendorLine.APPLIEDRATE;
                        }),
                        byQty: MatchedLines.byItem.filter(function (poLine) {
                            return poLine.AVAILQTY == vendorLine.AVAILQTY;
                        })
                    });

                    (MatchedLines.byRateQty || []).forEach(function (matchedLine) {
                        if (!matchedLine.AVAILQTY) return;

                        var appliedLine = vendorLine.UseQuantity(matchedLine.AVAILQTY);

                        if (appliedLine.APPLIEDQTY) {
                            vendorLine.MATCHING.push(vclib_util.extend(matchedLine, appliedLine));
                            matchedLine.UseQuantity(appliedLine.APPLIEDQTY);
                        }

                        return true;
                    });

                    (MatchedLines.byRate || []).forEach(function (matchedLine) {
                        if (!matchedLine.AVAILQTY) return;

                        var qty = Math.min(matchedLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        if (appliedLine.APPLIEDQTY) {
                            vendorLine.MATCHING.push(vclib_util.extend(matchedLine, appliedLine));
                            matchedLine.UseQuantity(appliedLine.APPLIEDQTY);
                        }
                    });

                    (MatchedLines.byQty || []).forEach(function (matchedLine) {
                        if (!matchedLine.AVAILQTY) return;

                        var qty = Math.min(matchedLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        if (appliedLine.APPLIEDQTY) {
                            vendorLine.MATCHING.push(vclib_util.extend(matchedLine, appliedLine));
                            matchedLine.UseQuantity(appliedLine.APPLIEDQTY);
                        }
                    });

                    MatchedLines.byItem.forEach(function (matchedLine) {
                        if (!matchedLine.AVAILQTY) return;

                        var qty = Math.min(matchedLine.AVAILQTY, vendorLine.AVAILQTY),
                            appliedLine = vendorLine.UseQuantity(qty);

                        if (appliedLine.APPLIEDQTY) {
                            vendorLine.MATCHING.push(vclib_util.extend(matchedLine, appliedLine));
                            matchedLine.UseQuantity(appliedLine.APPLIEDQTY);
                        }
                    });

                    return true;
                });

                vendorLines.sort(function (a, b) {
                    return a.line - b.line;
                });

                returnValue = vendorLines;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Matches PO lines to vendor lines (inverse direction of matchVendorLines).
         * NOT YET IMPLEMENTED — reserved for future use.
         *
         * @param {Object} option - Configuration object
         * @returns {false} Always returns false (not yet implemented)
         */
        matchPOLines: function (option) {
            var logTitle = [LogTitle, 'matchPOLines'].join('::'),
                returnValue = false;

            try {
                throw { code: 'NOT_IMPLEMENTED', details: 'matchPOLines is not yet implemented' };
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Checks if a PO line item matches a vendor line item using direct comparison (item name, SKU, MPN, etc).
         *
         * @param {Object} option - Configuration object
         * @param {Object} option.poLine - PO line object (REQUIRED)
         * @param {Object} option.vendorLine - Vendor line object (REQUIRED)
         * @param {Object} [option.mainConfig] - Main configuration object
         * @param {Object} [option.vendorConfig] - Vendor configuration object
         * @returns {boolean|null} true if the PO line matches the vendor line; false if no match; null on error
         *
         * @example
         * var isMatch = LibItemMatching.isItemMatched({
         *   poLine: poLineObj,
         *   vendorLine: vendorLineObj
         * });
         */
        isItemMatched: function (option) {
            var logTitle = [LogTitle, 'isItemMatched'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                if (!option.poLine) throw { code: 'MISSING_PARAMETER', details: 'poLine' };
                if (!option.vendorLine) throw { code: 'MISSING_PARAMETER', details: 'vendorLine' };

                var poLine = option.poLine,
                    vendorLine = option.vendorLine,
                    MainCFG = option.mainConfig || {},
                    VendorCFG = option.vendorConfig || {};

                var VendorList = vclib_constant.LIST.XML_VENDOR,
                    GlobalVar = vclib_constant.GLOBAL;

                var settings = {
                    isDandH:
                        option.isDandH !== undefined
                            ? option.isDandH
                            : VendorCFG
                              ? VendorCFG.xmlVendor == VendorList.DandH
                              : false,
                    ingramHashSpace:
                        option.ingramHashSpace !== undefined
                            ? option.ingramHashSpace
                            : MainCFG
                              ? MainCFG.ingramHashSpace
                              : null,
                    isIngram:
                        option.isIngram !== undefined
                            ? option.isIngram
                            : VendorCFG
                              ? vclib_util.inArray(VendorCFG.xmlVendor, [
                                    VendorList.INGRAM_MICRO_V_ONE,
                                    VendorList.INGRAM_MICRO
                                ])
                              : null,
                    isDell:
                        option.isDell !== undefined
                            ? option.isDell
                            : VendorCFG
                              ? VendorCFG.xmlVendor == VendorList.DELL
                              : false
                };

                var poItem = {
                    name: poLine.item_text || poLine.itemText || poLine.itemName,
                    skuValue:
                        poLine[GlobalVar.ITEM_ID_LOOKUP_COL] ||
                        poLine[GlobalVar.VENDOR_SKU_LOOKUP_COL],
                    sitemName: poLine.sitemname,
                    dnhValue: option.dnhValue || poLine[vclib_constant.FIELD.TRANSACTION.DH_MPN],
                    dellQuoteNo:
                        option.dellQuoteNo || poLine[vclib_constant.FIELD.TRANSACTION.DELL_QUOTE_NO]
                };

                var matchedCondition = null;
                var matchingCondition = {
                    ITEM: function () {
                        return (
                            (vendorLine.ITEM_TEXT &&
                                vclib_util.inArray(vendorLine.ITEM_TEXT, [
                                    poItem.name,
                                    poItem.skuValue
                                ])) ||
                            (vendorLine.ITEM_ALT &&
                                vclib_util.inArray(vendorLine.ITEM_ALT, [
                                    poItem.name,
                                    poItem.skuValue
                                ])) ||
                            (vendorLine.ITEM_MPN &&
                                vclib_util.inArray(vendorLine.ITEM_MPN, [
                                    poItem.name,
                                    poItem.skuValue
                                ])) ||
                            (vendorLine.ITEM_SKU &&
                                vclib_util.inArray(vendorLine.ITEM_SKU, [
                                    poItem.name,
                                    poItem.skuValue
                                ]))
                        );
                    },
                    ALTITEM_COL: function () {
                        var isMatched = false;

                        var valuesToMatch = [
                            vendorLine.ITEM_TEXT,
                            vendorLine.ITEM_SKU,
                            vendorLine.ITEM_MPN
                        ].filter(function (value) {
                            return !vclib_util.isEmpty(value);
                        });

                        [VendorCFG.itemColumnIdToMatch, VendorCFG.itemMPNColumnIdToMatch].forEach(
                            function (columnId) {
                                if (isMatched) return true;
                                if (!columnId || !poLine[columnId]) return;

                                isMatched = vclib_util.inArray(poLine[columnId], valuesToMatch);
                            }
                        );

                        if (!isMatched) {
                            [MainCFG.itemColumnIdToMatch, MainCFG.itemMPNColumnIdToMatch].forEach(
                                function (columnId) {
                                    if (isMatched) return true;
                                    if (!columnId || !poLine[columnId]) return;

                                    isMatched = vclib_util.inArray(poLine[columnId], valuesToMatch);
                                }
                            );
                        }

                        return isMatched;
                    },
                    DNH_ITEM: function () {
                        return (
                            settings.isDandH &&
                            poItem.dnhValue &&
                            vclib_util.inArray(poItem.dnhValue, [
                                vendorLine.ITEM_TEXT,
                                vendorLine.ITEM_SKU,
                                vendorLine.ITEM_MPN
                            ])
                        );
                    },
                    DELL_ITEM: function () {
                        return (
                            settings.isDell &&
                            poItem.dellQuoteNo &&
                            vclib_util.inArray(poItem.dellQuoteNo, [
                                vendorLine.ITEM_TEXT,
                                vendorLine.ITEM_SKU,
                                vendorLine.ITEM_MPN
                            ])
                        );
                    },
                    NO_SP_CHARS: function () {
                        var vendorLineValues = [
                            vendorLine.ITEM_TEXT
                                ? vendorLine.ITEM_TEXT.replace(/[^a-zA-Z0-9]/g, '')
                                : null,
                            vendorLine.ITEM_ALT
                                ? vendorLine.ITEM_ALT.replace(/[^a-zA-Z0-9]/g, '')
                                : null,
                            vendorLine.ITEM_MPN
                                ? vendorLine.ITEM_MPN.replace(/[^a-zA-Z0-9]/g, '')
                                : null,
                            vendorLine.ITEM_SKU
                                ? vendorLine.ITEM_SKU.replace(/[^a-zA-Z0-9]/g, '')
                                : null
                        ];

                        return (
                            (poItem.name
                                ? vclib_util.inArray(
                                      poItem.name.replace(/[^a-zA-Z0-9]/g, ''),
                                      vendorLineValues
                                  )
                                : false) ||
                            (poItem.skuValue
                                ? vclib_util.inArray(
                                      poItem.skuValue.replace(/[^a-zA-Z0-9]/g, ''),
                                      vendorLineValues
                                  )
                                : false)
                        );
                    }
                };
                for (var key in matchingCondition) {
                    var result = matchingCondition[key].call();
                    if (result) {
                        vendorLine.MATCHED_BY = key;
                        vendorLine.HAS_MATCH = true;
                        matchedCondition = key;
                        break;
                    }
                }

                returnValue = matchedCondition ? true : false;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },

        /**
         * Checks if a PO line item matches a vendor line item using alternative item names from item records.
         *
         * @param {Object} option - Configuration object
         * @param {Object} option.poLine - PO line object (REQUIRED)
         * @param {Object} option.vendorLine - Vendor line object (REQUIRED)
         * @param {Object} option.listAltNames - Map of item IDs to arrays of alternative names
         * @param {Object} [option.mainConfig] - Main configuration object
         * @param {Object} [option.vendorConfig] - Vendor configuration object
         * @returns {boolean|null} true if the PO line matches by alternative name; false if no match; null on error
         *
         * @example
         * var isAltMatch = LibItemMatching.isItemAltMatched({
         *   poLine: poLineObj,
         *   vendorLine: vendorLineObj,
         *   listAltNames: altNamesMap
         * });
         */
        isItemAltMatched: function (option) {
            var logTitle = [LogTitle, 'isItemAltMatched'].join('::'),
                returnValue = null;
            option = option || {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                if (!option.poLine) throw { code: 'MISSING_PARAMETER', details: 'poLine' };
                if (!option.vendorLine) throw { code: 'MISSING_PARAMETER', details: 'vendorLine' };

                var poLine = option.poLine,
                    vendorLine = option.vendorLine,
                    listAltNames = option.listAltNames,
                    MainCFG = option.mainConfig || vcs_configLib.mainConfig() || {},
                    VendorCFG = option.vendorConfig || {};

                if (!listAltNames || !listAltNames[poLine.item])
                    throw { code: 'NO_ALT_NAMES', detail: poLine.item };

                var altItemNames = listAltNames[poLine.item];
                var isMatched = false,
                    valuesToMatch = [
                        vendorLine.ITEM_TEXT,
                        vendorLine.ITEM_SKU,
                        vendorLine.ITEM_MPN
                    ].filter(function (value) {
                        return !vclib_util.isEmpty(value);
                    });

                [VendorCFG.itemFieldIdToMatch, VendorCFG.itemMPNFieldIdToMatch].forEach(
                    function (columnId) {
                        if (isMatched) return true;
                        if (!columnId || !altItemNames[columnId]) return;

                        isMatched = vclib_util.inArray(altItemNames[columnId], valuesToMatch);
                    }
                );

                if (!isMatched) {
                    [MainCFG.itemFieldIdToMatch, MainCFG.itemMPNFieldIdToMatch].forEach(
                        function (columnId) {
                            if (isMatched) return true;
                            if (!columnId || !altItemNames[columnId]) return;

                            isMatched = vclib_util.inArray(altItemNames[columnId], valuesToMatch);
                        }
                    );
                }

                if (isMatched) {
                    vendorLine.MATCHED_BY = 'ALTITEM_REC';
                    vendorLine.HAS_MATCH = true;
                }

                returnValue = isMatched;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = null;
            }

            return returnValue;
        },

        /**
         * Checks if a PO line item matches a vendor line item using mapped items (from vendor item mapping records).
         *
         * @param {Object} option - Configuration object
         * @param {Object} option.poLine - PO line object (REQUIRED)
         * @param {Object} option.vendorLine - Vendor line object (REQUIRED)
         * @param {Object} option.listMappedItems - Map of item IDs to arrays of mapped items
         * @returns {boolean|null} true if the PO line matches by vendor item mapping; false if no match; null on error
         *
         * @example
         * var isMapped = LibItemMatching.isItemMapped({
         *   poLine: poLineObj,
         *   vendorLine: vendorLineObj,
         *   listMappedItems: mappedItemsMap
         * });
         */
        isItemMapped: function (option) {
            var logTitle = [LogTitle, 'isItemMapped'].join('::'),
                returnValue = null;
            option = option || {};

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                if (!option.poLine) throw { code: 'MISSING_PARAMETER', details: 'poLine' };
                if (!option.vendorLine) throw { code: 'MISSING_PARAMETER', details: 'vendorLine' };

                var poLine = option.poLine,
                    vendorLine = option.vendorLine,
                    listMappedItems = option.listMappedItems;

                if (!listMappedItems || !listMappedItems[poLine.item]) {
                    // no mapped names for this item
                    return false;
                }

                var isMatched = false;
                listMappedItems[poLine.item].forEach(function (mappedItem) {
                    if (isMatched) return;
                    isMatched = vclib_util.inArray(mappedItem, [
                        vendorLine.ITEM_TEXT,
                        vendorLine.ITEM_SKU,
                        vendorLine.ITEM_MPN
                    ]);
                });

                if (isMatched) {
                    vendorLine.MATCHED_BY = 'MAPPING';
                    vendorLine.HAS_MATCH = true;
                }
                returnValue = isMatched;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = null;
            }

            return returnValue;
        },

        /**
         * Fetches item mappings from the vendor item mapping record.
         *
         * @param {Object} option - Configuration object
         * @param {Array<string|number>} [option.itemIds] - Array of item internal IDs to fetch mappings for
         * @param {Array<Object>} [option.orderLines] - Array of order line objects to extract item IDs from
         * @returns {Object|false|null} Map of item IDs to arrays of vendor-alias names; false on search/cache error;
         *   null on parameter validation failure
         *
         * @example
         * var mappings = LibItemMatching.fetchItemMapping({
         *   itemIds: [123, 456]
         * });
         */
        fetchItemMapping: function (option) {
            var logTitle = [LogTitle, 'fetchItemMapping'].join('::'),
                returnValue = null;

            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                if (!option.itemIds && !option.orderLines)
                    throw { code: 'MISSING_PARAMETER', details: 'itemIds or orderLines' };

                var ItemMapREC = vclib_constant.RECORD.VENDOR_ITEM_MAPPING;

                var itemIds =
                    option.itemIds ||
                    option.orderLines.map(function (line) {
                        return line.item;
                    });

                if (vclib_util.isEmpty(itemIds))
                    throw { code: 'MISSING_PARAMETER', details: 'No itemIds found' };

                var currentMappedItems =
                    Current.MAPPED_ITEMS ||
                    vclib_util.getNSCache({
                        name: 'MAPPED_ITEMS',
                        isJSON: true
                    }) ||
                    {};

                var missingItemIds = [];
                itemIds.forEach(function (itemId) {
                    if (vclib_util.isEmpty(currentMappedItems[itemId])) {
                        missingItemIds.push(itemId);
                    }
                });

                if (!missingItemIds.length) {
                    returnValue = currentMappedItems;

                    return returnValue;
                }

                var searchOption = {
                    type: ItemMapREC.ID,
                    columns: ['internalid', 'name', ItemMapREC.FIELD.ITEM],
                    filters: [[ItemMapREC.FIELD.ITEM, 'anyof', missingItemIds]]
                };
                var arrSearchResults = vclib_util.searchAllPaged({
                    searchObj: ns_search.create(searchOption)
                });

                arrSearchResults.forEach(function (result) {
                    var itemId = result.getValue(ItemMapREC.FIELD.ITEM),
                        mappedName = result.getValue('name');

                    if (!currentMappedItems[itemId]) currentMappedItems[itemId] = [];
                    currentMappedItems[itemId].push(mappedName);
                });

                vclib_util.setNSCache({
                    name: 'MAPPED_ITEMS',
                    value: currentMappedItems
                });
                Current.MAPPED_ITEMS = currentMappedItems;

                returnValue = currentMappedItems;

                vclib_util.log(logTitle, '*** Mapped Item Names:', currentMappedItems);
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },

        /**
         * Fetches alternative item names from item records.
         *
         * @param {Object} option - Configuration object
         * @param {Array<string|number>} [option.itemIds] - Array of item internal IDs to fetch alt names for
         * @param {Array<Object>} [option.orderLines] - Array of order line objects to extract item IDs from
         * @param {Object} [option.mainConfig] - Main configuration object
         * @param {Object} [option.vendorConfig] - Vendor configuration object
         * @returns {Object|null} Map of item IDs to alternative name field objects; null on error or when
         *   no alt-name fields are configured in MainCFG/VendorCFG
         *
         * @example
         * var altNames = LibItemMatching.fetchItemAltNames({
         *   itemIds: [123, 456]
         * });
         */
        fetchItemAltNames: function (option) {
            var logTitle = [LogTitle, 'fetchItemAltNames'].join('::'),
                returnValue = null;
            try {
                if (!option) throw { code: 'MISSING_PARAMETER', details: 'option' };
                if (!option.itemIds && !option.orderLines)
                    throw { code: 'MISSING_PARAMETER', details: 'itemIds or orderLines' };

                var MainCFG = option.mainConfig || {},
                    VendorCFG = option.vendorConfig || {};

                var arrItemIds =
                    option.itemIds ||
                    option.orderLines.map(function (line) {
                        return line.item;
                    });

                if (vclib_util.isEmpty(arrItemIds))
                    throw { code: 'MISSING_PARAMETER', details: 'No itemIds found' };

                var currentAltNames =
                    Current.ALTNAMES ||
                    vclib_util.getNSCache({ name: 'ALT_ITEM_NAMES', isJSON: true }) ||
                    {};

                var missedItemIds = [];
                arrItemIds.forEach(function (itemId) {
                    if (vclib_util.isEmpty(currentAltNames[itemId])) {
                        missedItemIds.push(itemId);
                    }
                });

                if (!missedItemIds.length) {
                    returnValue = currentAltNames;

                    return returnValue;
                }

                var searchOption = {
                    type: 'item',
                    columns: [],
                    filters: [['internalid', 'anyof', missedItemIds]]
                };

                if (MainCFG.itemFieldIdToMatch)
                    searchOption.columns.push(MainCFG.itemFieldIdToMatch);
                if (MainCFG.itemMPNFieldIdToMatch)
                    searchOption.columns.push(MainCFG.itemMPNFieldIdToMatch);

                if (VendorCFG.itemFieldIdToMatch)
                    searchOption.columns.push(VendorCFG.itemFieldIdToMatch);
                if (VendorCFG.itemMPNFieldIdToMatch)
                    searchOption.columns.push(VendorCFG.itemMPNFieldIdToMatch);

                searchOption.columns = vclib_util.uniqueArray(searchOption.columns);

                if (!searchOption.columns.length) throw { code: 'NO_ALT_NAMES_TO_FETCH' };

                searchOption.columns.push('name');

                var arrSearchResults = vclib_util.searchAllPaged({
                    searchObj: ns_search.create(searchOption)
                });

                arrSearchResults.forEach(function (result) {
                    var itemData = {
                        id: result.id,
                        name: result.getValue('name')
                    };

                    searchOption.columns.forEach(function (col) {
                        var colName = col.name || col;
                        itemData[colName] = result.getValue(col);
                    });

                    currentAltNames[itemData.id] = itemData;
                });

                vclib_util.setNSCache({
                    name: 'ALT_ITEM_NAMES',
                    value: currentAltNames
                });
                Current.ALTNAMES = currentAltNames;

                returnValue = currentAltNames;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = null;
            }

            return returnValue;
        }
    };

    return LibItemMatching;
});
