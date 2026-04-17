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
 * Script Name: CTC VC | Retrieve API Files Debugger SS
 * Script ID: customscript_ctc_vc_retrieve_api_files_debugger
 *
 * @author brianf@nscatalyst.com
 * @description Map/Reduce script that calls vendor APIs to retrieve and stage bill files.
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-25   brianf        Fixed copyAndDeploy to return the fallback task result; corrected ns_error alias in forceDeploy
 * 2026-03-17   brianf        Converted AMD module loading, normalized module aliases, and fixed fallback deployment return handling
 * 2026-02-27   brianf        Updated script header for standards compliance
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType ScheduledScript
 */

define(function (require) {
    var ns_search = require('N/search'),
        ns_runtime = require('N/runtime'),
        ns_error = require('N/error'),
        ns_record = require('N/record'),
        ns_task = require('N/task');

    // Fixed: align AMD module aliases with the project naming convention.
    var vclib_moment = require('./../Services/lib/moment'),
        vc2_util = require('./../CTC_VC2_Lib_Utils'),
        vc2_constant = require('./../CTC_VC2_Constants');

    var vclib_billfile = require('./Libraries/CTC_VC_Lib_Create_Bill_Files'),
        vclib_vendormap = require('./Libraries/CTC_VC_Lib_Vendor_Map'),
        vcs_configlib = require('./../Services/ctc_svclib_configlib'),
        vcs_recordlib = require('./../Services/ctc_svclib_records');

    var LogTitle = 'MR_BillFiles-API',
        VCLOG_APPNAME = 'VAR Connect|Retrieve Bill (API)',
        LogPrefix = '';

    var ERROR_MSG = vc2_constant.ERRORMSG,
        LOG_STATUS = vc2_constant.LIST.VC_LOG_STATUS,
        MAX_NO_DEPLOYMENTS = 20,
        MAX_NO_PO = 100;

    var Helper = {
        forceDeploy: function (option) {
            var logTitle = [LogTitle, 'forceDeploy'].join('::');
            var returnValue = null;

            var FN = {
                randomStr: function (len) {
                    len = len || 5;
                    var str = new Date().getTime().toString();
                    return str.substring(str.length - len, str.length);
                },
                deploy: function (scriptId, deployId, scriptParams, taskType) {
                    var logTitle = [LogTitle, 'forceDeploy:deploy'].join('::');
                    var returnValue = false;

                    try {
                        var taskInfo = {
                            taskType: taskType,
                            scriptId: scriptId
                        };
                        if (deployId) taskInfo.deploymentId = deployId;
                        if (scriptParams) taskInfo.params = scriptParams;

                        var objTask = ns_task.create(taskInfo);

                        var taskId = objTask.submit();
                        var taskStatus = ns_task.checkStatus({
                            taskId: taskId
                        });

                        // check the status
                        vc2_util.log(logTitle, '## DEPLOY status: ', {
                            id: taskId,
                            status: taskStatus
                        });
                        returnValue = taskId;
                    } catch (e) {
                        vc2_util.log(logTitle, '## ERROR ## ', vc2_util.extractError(e));
                    }

                    return returnValue;
                },
                copyDeploy: function (scriptId) {
                    var logTitle = [LogTitle, 'forceDeploy:copyDeploy'].join('::');
                    var returnValue = false;
                    try {
                        var searchDeploy = ns_search.create({
                            type: ns_search.Type.SCRIPT_DEPLOYMENT,
                            filters: [
                                ['script.scriptid', 'is', scriptId],
                                'AND',
                                ['status', 'is', 'NOTSCHEDULED'],
                                'AND',
                                ['isdeployed', 'is', 'T']
                            ],
                            columns: ['scriptid']
                        });
                        var newDeploy = null;

                        searchDeploy.run().each(function (result) {
                            if (!result.id) return false;
                            newDeploy = ns_record.copy({
                                type: ns_record.Type.SCRIPT_DEPLOYMENT,
                                id: result.id
                            });

                            var newScriptId = result.getValue({ name: 'scriptid' });
                            newScriptId = newScriptId.toUpperCase().split('CUSTOMDEPLOY')[1];
                            newScriptId = [newScriptId.substring(0, 20), FN.randomStr()].join('_');

                            newDeploy.setValue({ fieldId: 'status', value: 'NOTSCHEDULED' });
                            newDeploy.setValue({ fieldId: 'isdeployed', value: true });
                            newDeploy.setValue({
                                fieldId: 'scriptid',
                                value: newScriptId.toLowerCase().trim()
                            });
                        });

                        return newDeploy
                            ? newDeploy.save({
                                  enableSourcing: false,
                                  ignoreMandatoryFields: true
                              })
                            : false;
                    } catch (e) {
                        vc2_util.logError(logTitle, e);
                        throw e;
                    }
                },
                copyAndDeploy: function (scriptId, params, taskType) {
                    // Fixed: return the submitted fallback task result instead of always returning undefined.
                    FN.copyDeploy(scriptId);
                    return FN.deploy(scriptId, null, params, taskType);
                }
            };
            ////////////////////////////////////////
            try {
                if (!option.scriptId)
                    throw ns_error.create({
                        name: 'MISSING_REQD_PARAM',
                        message: 'missing script id',
                        notifyOff: true
                    });

                if (!option.taskType) {
                    option.taskType = ns_task.TaskType.SCHEDULED_SCRIPT;
                    option.taskType = option.isMapReduce
                        ? ns_task.TaskType.MAP_REDUCE
                        : option.isSchedScript
                          ? ns_task.TaskType.SCHEDULED_SCRIPT
                          : option.taskType;
                }

                vc2_util.log(logTitle, '// params', option);

                returnValue =
                    FN.deploy(
                        option.scriptId,
                        option.deployId,
                        option.scriptParams,
                        option.taskType
                    ) ||
                    FN.deploy(option.scriptId, null, option.scriptParams, option.taskType) ||
                    FN.copyAndDeploy(option.scriptId, option.scriptParams, option.taskType);

                vc2_util.log(logTitle, '// deploy: ', returnValue);
            } catch (e) {
                vc2_util.logError(logTitle, e);
                throw e;
            }
            ////////////////////////////////////////

            // initiate the cleanup
            this.cleanUpDeployment(option);

            return returnValue;
        },
        cleanUpDeployment: function (option) {
            var logTitle = [LogTitle, 'cleanUpDeployment'].join('::');

            var searchDeploy = ns_search.create({
                type: ns_search.Type.SCRIPT_DEPLOYMENT,
                filters: [
                    ['script.scriptid', 'is', option.scriptId],
                    'AND',
                    ['status', 'is', 'NOTSCHEDULED'],
                    'AND',
                    ['isdeployed', 'is', 'T']
                ],
                columns: ['scriptid']
            });

            var maxAllowed = option.max || MAX_NO_DEPLOYMENTS; // only allow 100
            var arrResults = vc2_util.searchGetAllResult(searchDeploy);

            vc2_util.log(logTitle, '>> cleanup : ', {
                maxAllowed: maxAllowed,
                totalResults: arrResults.length
            });
            if (maxAllowed > arrResults.length) return;

            var currentScript = ns_runtime.getCurrentScript();
            var countDelete = arrResults.length - maxAllowed;
            var idx = 0;

            while (countDelete-- && currentScript.getRemainingUsage() > 100) {
                try {
                    ns_record.delete({
                        type: ns_record.Type.SCRIPT_DEPLOYMENT,
                        id: arrResults[idx++].id
                    });
                } catch (del_err) {}
            }
            vc2_util.log(logTitle, '// Total deleted: ', idx);

            return true;
        }
    };

    var MAP_REDUCE = {};

    MAP_REDUCE.getInputData = function () {
        var logTitle = [LogTitle, 'getInputData'].join(':');
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        LogPrefix = '[getInputData] ';

        var paramConfigID = ns_runtime.getCurrentScript().getParameter({
                name: 'custscript_ctcvc_deb_getbillapi_vendor'
            }),
            paramOrderId = ns_runtime.getCurrentScript().getParameter({
                name: 'custscript_ctcvc_deb_getbillapi_poid'
            });

        var license = vcs_configlib.validateLicense();
        if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

        var BillCFG = paramConfigID
            ? vcs_configlib.billVendorConfig({ configId: paramConfigID })
            : null;

        var arrInternalIds = !vc2_util.isEmpty(paramOrderId) ? paramOrderId.split(/\s*,\s*/g) : [];

        if (paramConfigID) LogPrefix += '[ConfigID:' + paramConfigID + '] ';
        if (paramOrderId) LogPrefix += '[PO ID:' + arrInternalIds.length + '] ';

        var searchObj = vcs_recordlib.searchPurchaseOrders({
            returnSearchObj: true,
            poId: paramConfigID ? null : arrInternalIds.length ? arrInternalIds : null,
            filters: (function () {
                var filters = [
                    /// only POs with active vendor billing config
                    [
                        "formulanumeric: CASE WHEN {vendor.custentity_vc_bill_config} IS NULL OR {vendor.custentity_vc_bill_config} = '' THEN 0 ELSE 1 END",
                        'greaterthan',
                        '0'
                    ]
                ];

                var arrStatusFilter = [
                    'PurchOrd:E', // PendingBilling_PartiallyReceived
                    'PurchOrd:F', // PendingBill
                    'PurchOrd:B' // PendingReceipt
                ];

                if (paramConfigID) {
                    filters.push('AND', [
                        'vendor.custentity_vc_bill_config',
                        'anyof',
                        paramConfigID
                    ]);

                    if (BillCFG && BillCFG.subsidiary && vc2_util.isOneWorld()) {
                        filters.push('AND', ['subsidiary', 'anyof', BillCFG.subsidiary.split(/,/)]);
                    }

                    if (BillCFG && BillCFG.enableFulfillment) {
                        arrStatusFilter.push('PurchOrd:B', 'PurchOrd:D'); // add PendingReceipt and PartiallyReceived
                    }
                }

                filters.push('AND', ['status', 'anyof'].concat(arrStatusFilter));
                return filters;
            })()
        });

        var totalPending = searchObj.runPaged().count;
        log.audit(logTitle, LogPrefix + '>> Orders To Process: ' + totalPending);

        if (!arrInternalIds.length && totalPending > MAX_NO_PO) {
            // try to redistribute the processing
            var allResults = vc2_util.searchAllPaged({ searchObj: searchObj });
            var allPOIds = allResults.map(function (result) {
                return result.id;
            });

            vc2_util.log(logTitle, '>> RESULTS length / PO Ids: ', [
                allResults.length,
                allPOIds.length
            ]);

            var arrChunks = vc2_util.sliceArrayIntoChunks(allPOIds, MAX_NO_PO);
            vc2_util.log(logTitle, '>> Chunked PO Ids: ', arrChunks.length);

            // create the new scheduled script tasks
            arrChunks.forEach(function (chunkPOIds) {
                var taskOption = {
                    scriptId: ns_runtime.getCurrentScript().id,
                    isMapReduce: true,
                    scriptParams: {
                        custscript_ctcvc_deb_getbillapi_poid: chunkPOIds.join(','),
                        custscript_ctcvc_deb_getbillapi_vendor: ''
                    }
                };
                vc2_util.log(logTitle, '... taskOption: ', taskOption);

                Helper.forceDeploy(taskOption);
            });
            /// then exit!
            return false;
        }

        return searchObj;
    };

    MAP_REDUCE.map = function (mapContext) {
        var logTitle = [LogTitle, 'map', mapContext.key].join(':');
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        var searchResult = JSON.parse(mapContext.value);
        var currentValue = searchResult.values,
            currentPO = searchResult.id;
        try {
            LogPrefix = '[purchaseorder:' + currentPO + '] MAP | ';
            vc2_util.LogPrefix = LogPrefix;

            vc2_util.dumpLog(logTitle, searchResult, '-- searchResult: ');
            vc2_util.log(logTitle, '-- Current Values: ', [currentValue, currentPO]);

            /// load the mainConfig
            var MainCFG = vcs_configlib.mainConfig();

            // load the billConfig
            var BillCFG = vcs_configlib.billVendorConfig({ poId: currentPO }) || {};
            BillCFG.poNum = MainCFG.overridePONum
                ? currentValue.custbody_ctc_vc_override_ponum || currentValue.tranid
                : currentValue.tranid;

            vc2_util.log(logTitle, '-- BillCFG: ', BillCFG);

            if (vc2_util.isOneWorld()) {
                BillCFG.subsidiary = currentValue.subsidiary.value || currentValue.subsidiary;
                BillCFG.country = currentValue['country.subsidiary']
                    ? currentValue['country.subsidiary'].value || currentValue['country.subsidiary']
                    : currentValue['subsidiary.country']
                      ? currentValue['subsidiary.country'].value ||
                        currentValue['subsidiary.country']
                      : null;
            } else BillCFG.country = ns_runtime.country;

            var entryFunction = BillCFG.entry_function;
            var arrInvoiceResp = [];

            vc2_util.log(logTitle, '## Config Obj:entryFunction: ', entryFunction);

            switch (entryFunction) {
                case 'arrow_api':
                    arrInvoiceResp = vclib_vendormap.arrow_api(currentPO, BillCFG);
                    break;
                case 'ingram_api':
                    arrInvoiceResp = vclib_vendormap.ingram_api(currentPO, BillCFG);
                    break;
                case 'techdata_api':
                    arrInvoiceResp = vclib_vendormap.techdata_api(currentPO, BillCFG);
                    break;
                case 'wefi_api':
                    arrInvoiceResp = vclib_vendormap.wefi(currentPO, BillCFG);
                    break;
                case 'jenne_api':
                    arrInvoiceResp = vclib_vendormap.jenne_api(currentPO, BillCFG);
                    break;
                case 'scansource_api':
                    arrInvoiceResp = vclib_vendormap.scansource_api(currentPO, BillCFG);
                    break;
                case 'synnex_api':
                    arrInvoiceResp = vclib_vendormap.synnex_api(currentPO, BillCFG);
                    break;
                case 'carahsoft_api':
                    arrInvoiceResp = vclib_vendormap.carahsoft_api(currentPO, BillCFG);
                    break;
            }

            vc2_util.log(logTitle, '/// Invoice Details: ', arrInvoiceResp);

            if (!vc2_util.isEmpty(arrInvoiceResp)) {
                // lets loop through the invoices and set the vendor if missing
                arrInvoiceResp.forEach(function (invResp) {
                    var invNo = invResp.ordObj.invoice;
                    if (vc2_util.isEmpty(invNo)) return;

                    mapContext.write([currentPO, invNo].join('::'), {
                        currentPO: currentPO,
                        BillCFG: BillCFG,
                        arrInvoices: [invResp]
                    });
                });
            }
        } catch (error) {
            vc2_util.logError(logTitle, error);
            vc2_util.vcLog({
                title: 'MR Bills Retrieve API | Error',
                error: error,
                recordId: currentPO,
                status: LOG_STATUS.API_ERROR
            });
        }

        return true;
    };

    MAP_REDUCE.reduce = function (reduceContext) {
        var logTitle = [LogTitle, 'reduce', reduceContext.key].join(':');
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        try {
            LogPrefix = '[key:' + reduceContext.key + '] REDUCE | ';
            vc2_util.LogPrefix = LogPrefix;

            vc2_util.log(logTitle, '>> Current Values: ', [
                reduceContext.values.length,
                reduceContext.values
            ]);

            reduceContext.values.forEach(function (jsonValue) {
                try {
                    var currentValue = JSON.parse(jsonValue);

                    // /// PROCESS THE BILL FILE
                    vclib_billfile.process(
                        currentValue.BillCFG,
                        currentValue.arrInvoices,
                        vclib_moment().unix()
                    );
                    // ////
                } catch (reduce_error) {
                    vc2_util.logWarn(logTitle, reduce_error);
                    vc2_util.vcLog({
                        title: 'MR Bills Retrieve API | Error',
                        error: reduce_error,
                        recordId: currentValue.currentPO,
                        status: LOG_STATUS.API_ERROR
                    });
                }

                return true;
            });
        } catch (error) {
            vc2_util.logError(logTitle, error);
        }

        return true;
    };

    MAP_REDUCE.summarize = function (summary) {
        vc2_constant.LOG_APPLICATION = VCLOG_APPNAME;

        handleErrorIfAny(summary);
        createSummaryRecord(summary);
    };

    function handleErrorIfAny(summary) {
        var inputSummary = summary.inputSummary;
        var mapSummary = summary.mapSummary;
        var reduceSummary = summary.reduceSummary;
        if (inputSummary.error) {
            var e = ns_error.create({
                name: 'INPUT_STAGE_FAILED',
                message: inputSummary.error
            });
            log.error('Stage: getInputData failed', e);
        }
        handleErrorInStage('map', mapSummary);
        handleErrorInStage('reduce', reduceSummary);
    }

    function handleErrorInStage(stage, summary) {
        summary.errors.iterator().each(function (key, value) {
            log.error(key, value);
            return true;
        });
    }

    function createSummaryRecord(summary) {
        try {
            var summaryJson = {
                script: ns_runtime.getCurrentScript().id,
                seconds: summary.seconds,
                usage: summary.usage,
                yields: summary.yields
            };

            log.audit('summary', summaryJson);
        } catch (e) {
            log.error('Stage: summary failed', e);
        }
    }

    // return MAP_REDUCE;
    var arrReduceData = {};

    return {
        execute: function (context) {
            var logTitle = [LogTitle, 'execute'].join('.'),
                returnValue;

            var searchResults = MAP_REDUCE.getInputData();
            if (!searchResults) return false;

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
