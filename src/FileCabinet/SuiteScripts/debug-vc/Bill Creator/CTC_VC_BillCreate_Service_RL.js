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
 * Script Name: CTC VC | Bill Create Service RL
 * Script ID: customscript_ctc_vc_rl_billfile_service
 *
 * @author brianf@nscatalyst.com
 * @description General-purpose Bill Creator Restlet exposing GET-based action routing for vendor bill retrieval
 *              (fetchbill) and bill file processing (processfile).
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-04-03   brianf        Initial build: fetchbill and processfile actions with vendor dispatch and bill file processing;
 *                              added BillCFG to fetchbill response for downstream processfile consumption
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType Restlet
 */

define(function (require) {
    var ns_runtime = require('N/runtime'),
        ns_search = require('N/search'),
        ns_error = require('N/error');

    var vc2_constant = require('./../CTC_VC2_Constants'),
        vc2_util = require('./../CTC_VC2_Lib_Utils');

    var vclib_vendormap = require('./Libraries/CTC_VC_Lib_Vendor_Map'),
        vclib_billfile = require('./Libraries/CTC_VC_Lib_Create_Bill_Files'),
        vclib_moment = require('./../Services/lib/moment');

    var vcs_configlib = require('./../Services/ctc_svclib_configlib'),
        vcs_recordlib = require('./../Services/ctc_svclib_records');

    var LogTitle = 'RL_BillCreateSvc',
        VCLOG_APPNAME = 'VAR Connect|Bill Create Service';

    var ERROR_MSG = vc2_constant.ERRORMSG,
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS;

    /**
     * Supported vendor entry_function names mapped to vclib_vendormap methods.
     * Used by fetchbill to dispatch the correct vendor API call.
     */
    var VENDOR_DISPATCH = {
        arrow_api: 'arrow_api',
        ingram_api: 'ingram_api',
        techdata_api: 'techdata_api',
        wefi_api: 'wefi',
        jenne_api: 'jenne_api',
        scansource_api: 'scansource_api',
        synnex_api: 'synnex_api',
        carahsoft_api: 'carahsoft_api'
    };

    var Helper = {
        /**
         * @function buildResponse
         * @description Build a standardized response object
         * @param {Object} option
         * @param {boolean} option.isSuccess
         * @param {string} option.message
         * @param {*} [option.data]
         * @param {*} [option.error]
         * @returns {Object} returnValue
         */
        buildResponse: function (option) {
            var logTitle = [LogTitle, 'buildResponse'].join('::');

            option = option || {};

            var returnValue = {
                isSuccess: option.isSuccess !== undefined ? option.isSuccess : false,
                message: option.message || '',
                data: option.data || null,
                error: option.error || null
            };

            return returnValue;
        },

        /**
         * @function loadBillConfig
         * @description Resolve BillCFG by billConfigId or poId precedence
         * @param {Object} option
         * @param {string} option.poId
         * @param {string} [option.billConfigId]
         * @returns {Object} returnValue - BillCFG object with poNum populated
         */
        loadBillConfig: function (option) {
            var logTitle = [LogTitle, 'loadBillConfig'].join('::');

            option = option || {};

            var returnValue = null;

            try {
                var poId = option.poId;
                var billConfigId = option.billConfigId || null;

                var BillCFG = billConfigId
                    ? vcs_configlib.billVendorConfig({ configId: billConfigId })
                    : vcs_configlib.billVendorConfig({ poId: poId });

                if (!BillCFG) {
                    throw ns_error.create({
                        name: 'BILL_CFG_NOT_FOUND',
                        message: 'No bill vendor configuration found for the given parameters.',
                        notifyOff: true
                    });
                }

                // Resolve effective PO number (same logic as MR map stage)
                var MainCFG = vcs_configlib.mainConfig();
                var poData = vcs_recordlib.searchPurchaseOrders({
                    poId: [poId],
                    returnSearchObj: false
                });

                if (poData && poData.length) {
                    var currentValue = poData[0].values || poData[0];
                    BillCFG.poNum = MainCFG.overridePONum
                        ? currentValue.custbody_ctc_vc_override_ponum || currentValue.tranid
                        : currentValue.tranid;

                    if (vc2_util.isOneWorld()) {
                        BillCFG.subsidiary =
                            currentValue.subsidiary
                                ? currentValue.subsidiary.value || currentValue.subsidiary
                                : BillCFG.subsidiary;
                        BillCFG.country = currentValue['country.subsidiary']
                            ? currentValue['country.subsidiary'].value ||
                              currentValue['country.subsidiary']
                            : currentValue['subsidiary.country']
                              ? currentValue['subsidiary.country'].value ||
                                currentValue['subsidiary.country']
                              : null;
                    } else {
                        BillCFG.country = ns_runtime.country;
                    }
                }

                returnValue = BillCFG;
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        },

        /**
         * @function dispatchVendor
         * @description Call the appropriate vclib_vendormap method based on entry_function
         * @param {Object} option
         * @param {string} option.poId
         * @param {Object} option.BillCFG
         * @returns {Array} returnValue - Array of normalized invoice response objects
         */
        dispatchVendor: function (option) {
            var logTitle = [LogTitle, 'dispatchVendor'].join('::');

            option = option || {};

            var returnValue = [];

            try {
                var poId = option.poId;
                var BillCFG = option.BillCFG;
                var entryFunction = BillCFG.entry_function;

                vc2_util.log(logTitle, '// entry_function: ', entryFunction);

                var vendorMethod = VENDOR_DISPATCH[entryFunction];
                if (!vendorMethod) {
                    throw ns_error.create({
                        name: 'UNSUPPORTED_VENDOR',
                        message: 'Unsupported vendor entry_function: ' + entryFunction,
                        notifyOff: true
                    });
                }

                if (!vclib_vendormap[vendorMethod]) {
                    throw ns_error.create({
                        name: 'VENDOR_METHOD_MISSING',
                        message: 'Vendor map method not found: ' + vendorMethod,
                        notifyOff: true
                    });
                }

                returnValue = vclib_vendormap[vendorMethod](poId, BillCFG) || [];
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        }
    };

    var Endpoint = {
        /**
         * @function get
         * @description GET entrypoint — routes to fetchbill or processfile based on context.action
         * @param {Object} context - GET request parameters
         * @param {string} context.action - Action to perform: 'fetchbill' or 'processfile'
         * @returns {Object} returnValue - Standardized response
         */
        get: function (context) {
            var logTitle = [LogTitle, 'GET'].join('::');

            vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

            var returnValue = null;

            try {
                vc2_util.log(logTitle, '### Request: ', context);

                var action = context.action;
                if (!action) {
                    throw ns_error.create({
                        name: 'MISSING_ACTION',
                        message: 'Missing required parameter: action',
                        notifyOff: true
                    });
                }

                switch (action) {
                    case 'fetchbill':
                        returnValue = Actions.fetchbill(context);
                        break;
                    case 'processfile':
                        returnValue = Actions.processfile(context);
                        break;
                    default:
                        throw ns_error.create({
                            name: 'UNSUPPORTED_ACTION',
                            message: 'Unsupported action: ' + action,
                            notifyOff: true
                        });
                }
            } catch (error) {
                vc2_util.logError(logTitle, error);
                returnValue = Helper.buildResponse({
                    isSuccess: false,
                    message: vc2_util.extractError(error),
                    error: vc2_util.extractError(error)
                });
            } finally {
                vc2_util.log(logTitle, '## EXIT SCRIPT ##', returnValue);
            }

            return returnValue;
        }
    };

    var Actions = {
        /**
         * @function fetchbill
         * @description Fetch vendor bill data via vendor API, return normalized invoices with raw payload
         * @param {Object} option
         * @param {string} option.poId - Purchase Order internal ID (required)
         * @param {string} [option.billConfigId] - Bill vendor config ID (optional, overrides poId lookup)
         * @param {string} [option.invoiceNo] - Filter results to a specific invoice number (optional)
         * @returns {Object} returnValue - Standardized response with invoice data
         */
        fetchbill: function (option) {
            var logTitle = [LogTitle, 'fetchbill'].join('::');

            option = option || {};

            var returnValue = null;

            try {
                var poId = option.poId;
                if (!poId) {
                    throw ns_error.create({
                        name: 'MISSING_PO_ID',
                        message: 'Missing required parameter: poId',
                        notifyOff: true
                    });
                }

                vc2_util.LogPrefix = '[purchaseorder:' + poId + '] FETCHBILL | ';

                // Validate license
                var license = vcs_configlib.validateLicense();
                if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

                // Resolve bill vendor configuration
                var BillCFG = Helper.loadBillConfig({
                    poId: poId,
                    billConfigId: option.billConfigId || null
                });

                vc2_util.log(logTitle, '// BillCFG: ', BillCFG);

                // Dispatch to vendor API
                var arrInvoiceResp = Helper.dispatchVendor({
                    poId: poId,
                    BillCFG: BillCFG
                });

                vc2_util.log(logTitle, '// Invoice response count: ', arrInvoiceResp.length);

                // Filter by invoiceNo if provided
                if (option.invoiceNo && arrInvoiceResp.length) {
                    var filterInvNo = option.invoiceNo;
                    arrInvoiceResp = arrInvoiceResp.filter(function (invResp) {
                        return invResp.ordObj && invResp.ordObj.invoice === filterInvNo;
                    });
                    vc2_util.log(logTitle, '// Filtered to invoiceNo: ', [
                        filterInvNo,
                        arrInvoiceResp.length
                    ]);
                }

                vc2_util.vcLog({
                    title: 'Bill Create Service | Fetch Bill',
                    content: JSON.stringify({
                        poId: poId,
                        entryFunction: BillCFG.entry_function,
                        invoiceCount: arrInvoiceResp.length
                    }),
                    recordId: poId,
                    status: LOG_STATUS.SUCCESS
                });

                returnValue = Helper.buildResponse({
                    isSuccess: true,
                    message: 'Retrieved ' + arrInvoiceResp.length + ' invoice(s)',
                    data: {
                        poId: poId,
                        billConfigId: option.billConfigId || null,
                        entryFunction: BillCFG.entry_function,
                        count: arrInvoiceResp.length,
                        BillCFG: BillCFG,
                        invoices: arrInvoiceResp
                    }
                });
            } catch (error) {
                vc2_util.logError(logTitle, error);
                vc2_util.vcLog({
                    title: 'Bill Create Service | Fetch Bill Error',
                    error: error,
                    recordId: option.poId,
                    status: LOG_STATUS.API_ERROR
                });

                returnValue = Helper.buildResponse({
                    isSuccess: false,
                    message: vc2_util.extractError(error),
                    error: vc2_util.extractError(error)
                });
            }

            return returnValue;
        },

        /**
         * @function processfile
         * @description Process vendor invoice data into bill file records via vclib_billfile.process
         * @param {Object} option
         * @param {string} option.BillCFG - JSON-encoded bill vendor config object (required)
         * @param {string} option.arrInvoices - JSON-encoded array of normalized invoice objects (required)
         * @param {string} [option.name] - Display name for the bill file batch (optional)
         * @returns {Object} returnValue - Standardized response with processing summary
         */
        processfile: function (option) {
            var logTitle = [LogTitle, 'processfile'].join('::');

            option = option || {};

            var returnValue = null;

            try {
                // Parse BillCFG from GET param
                var rawBillCFG = option.BillCFG;
                if (!rawBillCFG) {
                    throw ns_error.create({
                        name: 'MISSING_BILL_CFG',
                        message: 'Missing required parameter: BillCFG',
                        notifyOff: true
                    });
                }

                var BillCFG;
                try {
                    BillCFG = util.isString(rawBillCFG)
                        ? JSON.parse(rawBillCFG)
                        : rawBillCFG;
                } catch (parseErr) {
                    throw ns_error.create({
                        name: 'INVALID_BILL_CFG',
                        message: 'BillCFG is not valid JSON: ' + vc2_util.extractError(parseErr),
                        notifyOff: true
                    });
                }

                // Parse arrInvoices from GET param
                var rawInvoices = option.arrInvoices;
                if (!rawInvoices) {
                    throw ns_error.create({
                        name: 'MISSING_INVOICES',
                        message: 'Missing required parameter: arrInvoices',
                        notifyOff: true
                    });
                }

                var arrInvoices;
                try {
                    arrInvoices = util.isString(rawInvoices)
                        ? JSON.parse(rawInvoices)
                        : rawInvoices;
                } catch (parseErr) {
                    throw ns_error.create({
                        name: 'INVALID_INVOICES',
                        message: 'arrInvoices is not valid JSON: ' + vc2_util.extractError(parseErr),
                        notifyOff: true
                    });
                }

                if (!util.isArray(arrInvoices) || !arrInvoices.length) {
                    throw ns_error.create({
                        name: 'EMPTY_INVOICES',
                        message: 'arrInvoices must be a non-empty array',
                        notifyOff: true
                    });
                }

                // Derive name fallback (timestamp-based, matching MR reduce pattern)
                var batchName = option.name || vclib_moment().unix();

                vc2_util.log(logTitle, '// Processing bill file batch: ', {
                    batchName: batchName,
                    invoiceCount: arrInvoices.length
                });

                // Execute bill file processing
                vclib_billfile.process(BillCFG, arrInvoices, batchName);

                vc2_util.vcLog({
                    title: 'Bill Create Service | Process File',
                    content: JSON.stringify({
                        batchName: batchName,
                        invoiceCount: arrInvoices.length
                    }),
                    status: LOG_STATUS.SUCCESS
                });

                returnValue = Helper.buildResponse({
                    isSuccess: true,
                    message: 'Processed ' + arrInvoices.length + ' invoice(s)',
                    data: {
                        name: batchName,
                        count: arrInvoices.length
                    }
                });
            } catch (error) {
                vc2_util.logError(logTitle, error);
                vc2_util.vcLog({
                    title: 'Bill Create Service | Process File Error',
                    error: error,
                    status: LOG_STATUS.API_ERROR
                });

                returnValue = Helper.buildResponse({
                    isSuccess: false,
                    message: vc2_util.extractError(error),
                    error: vc2_util.extractError(error)
                });
            }

            return returnValue;
        }
    };

    return Endpoint;
});
