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
 * Script Name: CTC VC | D&H Item Request MR
 * Script ID: customscript_ctc_vc_mr_dhitemrequest
 * @author paolodl@nscatalyst.com
 * @description Map/Reduce script to fetch and update D&H item master data for VAR Connect integration
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-14   brianf                Fixed debugger search-result field mappings and removed stray trailing statement that caused runtime failure
 * 2022-10-25   christian@            Support non-inventory type
 * 2020-01-01   paolodl@              Initial Build
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType ScheduledScript
 */
define([
    'N/search',
    'N/record',
    'N/runtime',
    './CTC_VC2_Lib_Utils.js',
    './CTC_VC2_Constants.js',
    './Services/ctc_svclib_configlib.js',
    './Services/ctc_svclib_webservice.js'
], function (
    ns_search,
    ns_record,
    ns_runtime,
    vc2_util,
    vc2_constant,
    vcs_configLib,
    vcs_websvcLib
) {
    var LogTitle = 'VC|D&H Item Request';
    var Current = {};

    var ERROR_MSG = vc2_constant.ERRORMSG,
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

    var Helper = {
        checkDandHVendorConfig: function (option) {
            var logTitle = [LogTitle, '_checkDandHVendorConfig'].join(':');

            var searchOption = {
                type: vc2_constant.RECORD.VENDOR_CONFIG.ID,
                columns: ['internalid'],
                filters: [
                    ['isinactive', 'is', 'F'],
                    'AND',
                    ['custrecord_ctc_vc_xml_vendor', 'anyof', vc2_constant.LIST.XML_VENDOR.DandH]
                ]
            };

            var searchObj = ns_search.create(searchOption);
            var totalResults = searchObj.runPaged().count;

            if (!(totalResults > 0)) {
                vc2_util.log(logTitle, 'No D&H vendor configuration set up');
                return false;
            }

            return true;
        }
    };

    var MAP_REDUCE = {};

    MAP_REDUCE.getInputData = function () {
        var logTitle = [LogTitle, 'getInputData'].join(':');

        var license = vcs_configLib.validateLicense();
        if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

        var MainCFG = vcs_configLib.mainConfig();
        if (!MainCFG) throw ERROR_MSG.MISSING_CONFIG;

        if (!Helper.checkDandHVendorConfig()) return;

        var searchId = ns_runtime
            .getCurrentScript()
            .getParameter('custscript_ctc_vcdeb_dnh_itemreq_srch');
        if (!searchId) searchId = 'customsearch_ctc_vc_dh_itemrequest';

        vc2_util.log(logTitle, 'Search id=' + searchId);

        var searchObj = ns_search.load({ id: searchId });
        var totalResults = searchObj.runPaged().count;

        vc2_util.log(logTitle, totalResults + ' item(s) to process.');

        return searchObj;
    };

    MAP_REDUCE.map = function (mapContext) {
        var logTitle = [LogTitle, 'map'].join(':');

        try {
            vc2_util.logDebug(logTitle, '###### START: MAP ######');
            var searchResult = JSON.parse(mapContext.value);
            // vc2_util.log(logTitle, 'searchResult=', searchResult);

            /// flatten - only for debugging
            for (var fld in searchResult.values) {
                if (util.isArray(searchResult.values[fld]) && searchResult.values[fld].length == 1) {
                    searchResult.values[fld] = searchResult.values[fld][0];
                }
            }

            var currentData = {
                poId: searchResult.id,
                itemId: searchResult.values.item.value,
                itemName: searchResult.values.item.text,
                itemType: searchResult.values['type.item'].value,
                upcCode: searchResult.values['upccode.item'],
                vendor: searchResult.values['internalid.vendor'].value,
                subsidiary: searchResult.values.subsidiary.value
            };
            vc2_util.log(logTitle, '/// currentData: ', currentData);

            // use the item id as key
            mapContext.write(currentData.itemId, currentData);
        } catch (error) {
            vc2_util.logError(logTitle, error);
            throw error;
        } finally {
            vc2_util.logDebug(logTitle, '###### END: MAP ###### ');
        }
    };

    MAP_REDUCE.reduce = function (reduceContext) {
        var logTitle = [LogTitle, 'reduce'].join(':');
        try {
            vc2_util.logDebug(logTitle, '###### START: REDUCE ######');
            var searchResult = JSON.parse(reduceContext.values[0]);
            vc2_util.log(logTitle, '// searchResult: ', searchResult);

            var itemDetails = vcs_websvcLib.DandHItemFetch({
                poId: searchResult.poId,
                itemId: searchResult.itemId,
                subsidiary: searchResult.subsidiary,
                vendor: searchResult.vendor
            });

            if (!itemDetails || !itemDetails.dnh || !itemDetails.dnhValue) {
                vc2_util.log(logTitle, '## ERROR: Failed to fetch item details', itemDetails);
                return true;
            }
            vc2_util.log(logTitle, '... Updating item:', itemDetails);

            var updateValue = {};
            updateValue[vc2_constant.FIELD.ITEM.DH_MPN] = itemDetails.dnhValue;

            var itemId = ns_record.submitFields({
                type: itemDetails.item.recordtype,
                id: searchResult.itemId,
                values: updateValue
            });
            vc2_util.log(logTitle, 'Item updated successfully: ', [
                itemId,
                {
                    type: itemDetails.item.recordtype,
                    id: searchResult.itemId,
                    values: updateValue
                }
            ]);

            // // send report to summarize
            // reduceContext.write({
            //     updatedItem: itemId,
            //     itemName: itemDetails.item.itemName,
            //     dnhValue: itemDetails.dnhValue
            // });
        } catch (error) {
            vc2_util.logError(logTitle, error);
            throw error;
        } finally {
            vc2_util.logDebug(logTitle, '###### END: REDUCE ###### ');
        }
    };

    MAP_REDUCE.summarize = function (summaryContext) {
        var logTitle = [LogTitle, 'summarize'].join(':');

        vc2_util.logDebug(logTitle, '###### START: SUMMARIZE ######');

        // report how many items were updated
        var totalUpdatedItems = 0;
        var updatedItems = [];
        summaryContext.output.iterator().each(function (key, value) {
            totalUpdatedItems++;
            updatedItems.push(value);
            return true;
        });

        vc2_util.log(logTitle, 'Total updated items:', totalUpdatedItems);
        vc2_util.log(logTitle, 'Updated Items:', updatedItems);

        vc2_util.logDebug(logTitle, '###### END: SUMMARIZE ######');
    };

    // return MAP_REDUCE;
    var arrReduceData = {};

    return {
        execute: function (context) {
            var logTitle = [LogTitle, 'execute'].join('.'),
                returnValue;

            var searchResults = MAP_REDUCE.getInputData();

            searchResults.run().each(function (result, idx) {
                MAP_REDUCE.map.call(this, {
                    key: idx,
                    value: JSON.stringify(result),
                    write: function (key, value) {
                        if (!arrReduceData[key]) arrReduceData[key] = [];
                        arrReduceData[key].push(JSON.stringify(value));
                    }
                });
                return true;
            });

            for (var key in arrReduceData) {
                MAP_REDUCE.reduce.call(this, {
                    key: key,
                    values: arrReduceData[key]
                });
            }

            return true;
        }
    };
});
