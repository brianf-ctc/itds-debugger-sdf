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
 * Script Name: ctc_svclib_billvendor.js
 * @author brianf@nscatalyst.com
 * @description Service layer for orchestrating API-based vendor bill retrieval for Bill Creator (API only).
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-01-29   brianf@               Initial build: API-only, fetchBillsAPI exposed
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var vc2_util = require('../../CTC_VC2_Lib_Utils');
    var ReturnValueLib = require('../../Services/lib/ctc_lib_returnvalue');

    // Vendor API module mapping (add more as needed)
    var VendorApiModules = {
        INGRAM: require('../Vendors/ingram_api.js')
        // Add more vendors here as needed
    };

    /**
     * Fetches bills from the specified vendor's API.
     * @param {Object} option - Options for bill retrieval
     * @param {string} option.vendor - Vendor code (e.g., 'INGRAM')
     * @param {Object} option.config - Vendor config object
     * @param {...*} option.* - Additional options passed to the vendor module
     * @returns {Object} Standardized return object
     */
    function fetchBillsAPI(option) {
        var logTitle = 'fetchBillsAPI';
        var returnValue = ReturnValueLib.create();
        try {
            option = option || {};
            var vendorCode = (option.vendor || '').toUpperCase();
            if (!vendorCode || !VendorApiModules[vendorCode]) {
                throw 'Unsupported or missing vendor: ' + vendorCode;
            }
            var vendorModule = VendorApiModules[vendorCode];
            // Call the vendor's bill-fetching method (assume process or processXml)
            var result = vendorModule.process(option);
            returnValue.data = result;
            returnValue.isSuccess = true;
            returnValue.message = 'Bills retrieved successfully';
        } catch (error) {
            ReturnValueLib.setError(returnValue, error);
            vc2_util.logError(logTitle, returnValue.message);
        }
        return returnValue;
    }

    // Expose only fetchBillsAPI for now
    var Endpoint = {
        fetchBillsAPI: fetchBillsAPI
    };
    return Endpoint;
});
