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
 * Script Name: CTC VC | Retrieve API Files SS
 * Script ID: customscript_ctc_vc_ss_fetchbills_api
 *
 * @author brianf@nscatalyst.com
 * @description Scheduled script that processes a single PO to retrieve and stage bill files from vendor APIs
 *              via the BillCreate Service Restlet.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-04-03   brianf                Refactored to delegate vendor retrieval and bill processing to BillCreate Service
 *                                      Restlet via vclib_utils.sendRequestRestlet
 * 2026-03-27   brianf                Grouped script parameters into ScriptParam object
 * 2026-03-20   brianf                Initial build; single-PO variant of CTC_VC_Retrieve_API_Files MR.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType ScheduledScript
 */

define(function (require) {
    var ns_runtime = require('N/runtime'),
        ns_record = require('N/record');

    var vclib_utils = require('./../Services/lib/ctc_lib_utils.js'),
        vclib_constant = require('./../Services/lib/ctc_lib_constants.js'),
        vclib_error = require('./../Services/lib/ctc_lib_error.js');

    var vc2_constant = require('./../CTC_VC2_Constants');

    var vcs_configlib = require('./../Services/ctc_svclib_configlib.js'),
        vcs_recordlib = require('./../Services/ctc_svclib_records.js');

    var LogTitle = 'SS_BillFiles-API',
        VCLOG_APPNAME = vclib_constant.APPNAME.BILL_RETRIEVAL || 'VAR Connect|Retrieve Bill (API)';

    var ERROR_MSG = vc2_constant.ERRORMSG,
        LOG_STATUS = vclib_constant.LIST.VC_LOG_STATUS;

    var RESTLET_CONFIG = {
        SCRIPT_ID: 'customscript_ctc_vc_rl_billfile_service',
        DEPLOY_ID: 'customdeploy_ctc_vc_rl_billfile_service'
    };

    function execute(context) {
        var logTitle = [LogTitle, 'execute'].join('::');
        var returnValue = true;

        var poId = null;

        try {
            vclib_constant.LOG_APPLICATION = VCLOG_APPNAME;

            var currentScript = ns_runtime.getCurrentScript();
            var ScriptParam = {
                poId: currentScript.getParameter({ name: 'custscript_ctc_vc_getbillss_poid' }),
                poNum: currentScript.getParameter({ name: 'custscript_ctc_vc_getbillss_ponum' })
            };

            vclib_utils.logDebug(logTitle, '###### START OF SCRIPT ######');
            vclib_utils.logDebug(logTitle, '// Script Parameters', ScriptParam);

            if (!ScriptParam.poId && !ScriptParam.poNum) {
                throw { code: 'MISSING_PARAMETER', detail: 'PO ID or PO Number' };
            }

            // ======== VALIDATE LICENSE & CONFIG ========
            var license = vcs_configlib.validateLicense();
            if (license.hasError) throw ERROR_MSG.INVALID_LICENSE;

            var poNum = ScriptParam.poNum;
            poId = ScriptParam.poId;

            // ======== RESOLVE PO BY NUMBER IF NEEDED ========
            if (!poId && poNum) {
                var searchPO = vcs_recordlib.searchTransaction({
                    tranid: poNum,
                    type: ns_record.Type.PURCHASE_ORDER
                });

                if (searchPO && searchPO.id) {
                    poId = searchPO.id;
                    poNum = searchPO.tranid;
                } else {
                    throw {
                        code: 'MISSING_PO',
                        detail: 'Unable to find PO by number: ' + poNum
                    };
                }
            }

            if (!poId) throw { code: 'MISSING_PARAMETER', detail: 'PO ID' };

            var LogPrefix = '[purchaseorder:' + poId + '] ';
            vclib_utils.LogPrefix = LogPrefix;

            vclib_utils.logDebug(logTitle, '>> Processing PO', { poId: poId, poNum: poNum });

            // ======== FETCH BILL VIA RESTLET ========
            vclib_utils.logDebug(logTitle, '## Calling BillCreate Service: fetchbill');

            var fetchResp = vclib_utils.sendRequestRestlet({
                header: VCLOG_APPNAME + ' | Fetch Bill',
                method: 'get',
                recordId: poId,
                isJSON: true,
                query: {
                    scriptId: RESTLET_CONFIG.SCRIPT_ID,
                    deploymentId: RESTLET_CONFIG.DEPLOY_ID,
                    urlParams: {
                        action: 'fetchbill',
                        poId: poId
                    }
                }
            });

            if (fetchResp.isError) throw fetchResp.errorMsg || 'Fetch bill request failed';

            var fetchData = fetchResp.PARSED_RESPONSE;
            if (!fetchData) throw 'Unable to parse fetchbill response';
            if (!fetchData.isSuccess) throw fetchData.message || 'Fetch bill returned error';

            var arrInvoiceResp = fetchData.data.invoices || [];
            var BillCFG = fetchData.data.BillCFG;

            vclib_utils.logDebug(logTitle, '/// Retrieved Invoices', {
                count: arrInvoiceResp.length,
                entryFunction: fetchData.data.entryFunction
            });

            // ======== PROCESS INVOICES VIA RESTLET ========
            if (arrInvoiceResp.length) {
                var processCount = 0;

                arrInvoiceResp.forEach(function (invResp) {
                    try {
                        vclib_utils.logDebug(logTitle, '... Processing invoice', {
                            invoice: invResp.ordObj ? invResp.ordObj.invoice : 'unknown'
                        });

                        var processResp = vclib_utils.sendRequestRestlet({
                            header: VCLOG_APPNAME + ' | Process File',
                            method: 'get',
                            recordId: poId,
                            isJSON: true,
                            query: {
                                scriptId: RESTLET_CONFIG.SCRIPT_ID,
                                deploymentId: RESTLET_CONFIG.DEPLOY_ID,
                                urlParams: {
                                    action: 'processfile',
                                    BillCFG: JSON.stringify(BillCFG),
                                    arrInvoices: JSON.stringify([invResp])
                                }
                            }
                        });

                        if (processResp.isError) {
                            throw processResp.errorMsg || 'Process file request failed';
                        }

                        var processData = processResp.PARSED_RESPONSE;
                        if (!processData) throw 'Unable to parse processfile response';
                        if (!processData.isSuccess) {
                            throw processData.message || 'Process file returned error';
                        }

                        processCount++;
                    } catch (processError) {
                        var errObj = vclib_error.log(logTitle, processError);
                        vclib_utils.vcLog({
                            title: VCLOG_APPNAME + ' | Invoice Processing Error',
                            message: errObj.message,
                            recordId: poId,
                            status: LOG_STATUS.ERROR
                        });
                        returnValue = false;
                    }
                });

                vclib_utils.vcLog({
                    title: VCLOG_APPNAME + ' | Success',
                    message:
                        'Processed ' + processCount + ' invoice(s) via BillCreate Service',
                    recordId: poId,
                    status: LOG_STATUS.SUCCESS
                });
            } else {
                vclib_utils.logDebug(logTitle, '>> No invoices returned from vendor');
                vclib_utils.vcLog({
                    title: VCLOG_APPNAME + ' | No Data',
                    message: 'No invoices returned from BillCreate Service (fetchbill)',
                    recordId: poId,
                    status: LOG_STATUS.SUCCESS
                });
            }
        } catch (error) {
            var errorObj = vclib_error.log(logTitle, error);
            vclib_utils.vcLog({
                title: VCLOG_APPNAME + ' | Error',
                message: errorObj.message,
                recordId: poId,
                status: LOG_STATUS.ERROR
            });
            returnValue = false;
        } finally {
            vclib_utils.logDebug(logTitle, '###### END OF SCRIPT ######');
        }

        return returnValue;
    }

    return {
        execute: execute
    };
});
