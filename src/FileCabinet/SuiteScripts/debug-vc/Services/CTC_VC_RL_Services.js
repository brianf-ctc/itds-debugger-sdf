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
 * Script Name: CTC VC | Services RL
 * Script ID: customscript_ctc_vc_rl_services
 * @author brianf@nscatalyst.com
 * @description Generic services Restlet that routes requests to specific VAR Connect service libraries.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Renamed txnLib to transactionLib in SERVICES_MAP
 * 2026-03-25   brianf        Consolidated recordsLibV1/V2 into single recordsLib; disabled orderstatusLib and webserviceLibV2; updated webserviceLibV1 path
 *                            to ctc_svclib_webservice.js
 * 2026-02-03   brianf        Migrated to lib_util/lib_constant; split recordsLib into V1/V2, added webserviceLibV2, removed ingramAPI; added error handling
 *                            to fetchModuleName; standardized returnValue, fixed GET handler logging and return
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType Restlet
 */
define(function (require) {
    var LogTitle = 'VC_SERV',
        LogPrefix = '';

    var lib_util = require('./lib/ctc_lib_utils.js'),
        lib_constant = require('./lib/ctc_lib_constants.js');

    var SERVICES_MAP = {
        billcreateLib: { lib: require('./ctc_svclib_billcreate') },
        configLib: { lib: require('./ctc_svclib_configlib.js') },
        itemmatching: { lib: require('./ctc_svclib_itemmatch.js') },
        // orderstatusLib: { lib: require('./ctc_svclib_orderstatus.js') },
        processV1: { lib: require('./ctc_svclib_process-v1.js') },
        recordsLib: { lib: require('./ctc_svclib_records.js') },
        transactionLib: { lib: require('./ctc_svclib_transaction.js') },
        webserviceLibV1: { lib: require('./ctc_svclib_webservice.js') }
        // webserviceLibV2: { lib: require('./ctc_svclib_webservice-v2.js') }
        // ingramAPI: { lib: require('../Bill Creator/Vendors/ingram_api.js') }
    };

    var Helper = {
        fetchModuleName: function (action) {
            var moduleName;

            try {
                for (var mod in SERVICES_MAP) {
                    if (lib_util.inArray(action, SERVICES_MAP[mod].actions)) moduleName = mod;
                    if (moduleName) break;
                }
            } catch (error) {
                lib_util.logError(LogTitle, error);
                throw 'Error fetching module name: ' + error;
            }
            return moduleName;
        }
    };

    return {
        post: function (context) {
            var logTitle = [LogTitle, 'POST'].join('::'),
                returnValue = {};

            try {
                lib_util.log(logTitle, '>> scriptContext:  ' + JSON.stringify(context));

                // validate the action
                if (!context || !util.isObject(context)) throw 'Invalid request';

                var actionName = context.action,
                    moduleName = context.moduleName || Helper.fetchModuleName(actionName);

                lib_util.log(logTitle, 'action/module', [actionName, moduleName]);

                if (!actionName) throw 'Missing action - ' + actionName;
                if (!moduleName) throw 'Unregistered action or missing module - ' + actionName;

                var moduleLib = SERVICES_MAP[moduleName].lib;
                if (!moduleLib[actionName]) throw 'Missing or Invalid method name - ' + actionName;

                returnValue = moduleLib[actionName].call(null, context.parameters || {});

                // look for service module
            } catch (error) {
                lib_util.logError(logTitle, error);

                returnValue = {
                    status: 'error',
                    isError: true,
                    logStatus: error ? error.logStatus : lib_constant.LIST.VC_LOG_STATUS.ERROR,
                    message: lib_util.extractError(error),
                    details: error.details || error
                };
            } finally {
                lib_util.log(logTitle, '/// returnObj:  ' + JSON.stringify(returnValue));
            }

            return returnValue;
        },
        get: function (context) {
            var logTitle = [LogTitle, 'GET'].join('::'),
                returnValue = {};

            try {
                // loop thru the modules
                for (var mod in SERVICES_MAP) {
                    if (SERVICES_MAP[mod].lib) {
                        returnValue[mod] = Object.keys(SERVICES_MAP[mod].lib);
                    }
                }
            } catch (error) {
                lib_util.logError(logTitle, error);
            }

            return returnValue;
        }
    };
});
