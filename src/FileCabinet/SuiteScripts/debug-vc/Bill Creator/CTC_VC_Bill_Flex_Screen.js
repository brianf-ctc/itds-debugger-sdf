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
 * Script Name: CTC VC | Bill Creator Flex Screen
 * Script ID: customscript_ctc_vc_bill_flex_screen
 *
 * @author brianf@nscatalyst.com
 * @description Main Bill Creator Flex Screen Suitelet for reviewing and adjusting bill files vs POs.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-28   brianf                Added Helper.roundOff with configurable decimal precision; replaced all vc2_util.roundOff
 *                                      calls; added variance checkbox mutual exclusion; refactored postAction variance flags
 * 2026-03-17   brianf                Sorted rendered bill lines by LINEIDX before populating the flex screen sublist
 * 2026-03-16   brianf                Fixed Flex Screen message handling, enabled safe VARIANCE/HOLD/ERROR warning rendering in edit-state checks, simplified preprocessBill control flow, and clarified preprocessBill local names/comments
 * 2026-03-14   brianf                Applied stability and edit-state fixes: added report/json guards, corrected ignoreVariance persistence and checkbox defaults, rendered charges under tab_charges, aligned misc charge display with enabled flag, and fixed Helper log/edit-state handling
 * 2026-03-13   brianf                Aligned with BillProcess updates: replaced implicit util usage with N/util,
 *                                      updated variance report key handling, and switched charge lookups to ChargesDEF/CHARGELINES
 * 2026-03-02   brianf                Fixed incorrect STATUS path: BILLPROC.PO.STATUS.isBillable → BILLPROC.STATUS.PO.IsBillable;
 *                                      fixed BILLPROC.BILLFILE.AllowVariance/IgnoreVariance → BILLPROC.STATUS.BILLFILE.*
 * 2026-02-27   brianf                Updated script header for standards compliance
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 * @NScriptType Suitelet
 */

define(function (require) {
    var ns_ui = require('N/ui/serverWidget'),
        ns_msg = require('N/ui/message'),
        ns_record = require('N/record'),
        ns_redirect = require('N/redirect'),
        ns_url = require('N/url'),
        ns_runtime = require('N/runtime'),
        ns_task = require('N/task'),
        ns_util = require('N/util');

    var vc_billprocess = require('./Libraries/CTC_VC_Lib_BillProcess'),
        vc_uihelper = require('./../CTC_VC_Lib_FormHelper'),
        vc2_constant = require('./../CTC_VC2_Constants'),
        vc2_util = require('./../CTC_VC2_Lib_Utils'),
        vc2_recordlib = require('./../CTC_VC2_Lib_Record'),
        vcs_configLib = require('./../Services/ctc_svclib_configlib');

    var LogTitle = 'FlexScreen',
        BILL_CREATOR = vc2_constant.Bill_Creator;

    var DEBUG_MODE = false;

    var Current = {
            UI: {
                Method: null,
                Task: null,
                Script: null,
                IsActiveEdit: true,
                IsFulfillable: false,
                IsBillable: false
            },
            CFG: {
                MainCFG: {},
                BillCFG: {},
                OrderCFG: {},
                ChargesDEF: {}
            },
            PO: {},
            BILL: {},
            BILLFILE: {},
            TOTAL: {},
            URL: {
                record: null,
                suitelet: null
            },
            MSG: {
                warning: [],
                error: [],
                info: []
            }
        },
        BILLPROC = {};

    var FLEXFORM_ACTION = {
            SAVE: { value: 'save', text: 'Save', default: true },
            RENEW: { value: 'renew', text: 'Save & Renew' },
            MANUAL: { value: 'manual', text: 'Save & Process Manually' },
            CLOSE: { value: 'close', text: 'Save & Close' },
            REPROCESS_HASVAR: {
                value: 'reprocess_hasvar',
                text: 'Submit & Process Variance'
            },
            REPROCESS_NOVAR: {
                value: 'reprocess_novar',
                text: 'Submit & Ignore Variance'
            },
            REPROCESS: { value: 'reprocess', text: 'Submit & Reprocess' },
            HOLD: { value: 'hold', text: 'Hold' }
        },
        LINE_ERROR_MSG = {
            UNMATCHED_ITEMS: {
                col: 'erroritem',
                msg: BILL_CREATOR.Code.UNMATCHED_ITEMS.msg
            },

            ITEMS_ALREADY_BILLED: {
                col: 'errorbilled',
                msg: BILL_CREATOR.Code.ITEMS_ALREADY_BILLED.msg
            },

            INSUFFICIENT_RECEIVABLES: {
                col: 'errorrecived',
                msg: BILL_CREATOR.Code.INSUFFICIENT_RECEIVABLES.msg
            },

            NOT_BILLABLE: {
                col: 'errorqty',
                msg: BILL_CREATOR.Code.NOT_BILLABLE.msg
            },

            INSUFFICIENT_BILLABLE: {
                col: 'errorqty',
                msg: BILL_CREATOR.Code.INSUFFICIENT_BILLABLE.msg
            },

            ITEM_NOT_BILLABLE: {
                col: 'errorqty',
                msg: BILL_CREATOR.Code.ITEM_NOT_BILLABLE.msg
            },

            ITEM_FULLY_BILLED: {
                col: 'errorbilled',
                msg: BILL_CREATOR.Code.ITEM_FULLY_BILLED.msg
            },

            INSUFFICIENT_QUANTITY: {
                col: 'errorqty',
                msg: BILL_CREATOR.Code.INSUFFICIENT_QUANTITY.msg
            },

            MISMATCH_RATE: {
                col: 'errorprice',
                msg: BILL_CREATOR.Code.MISMATCH_RATE.msg
            },

            PRICE: {
                col: 'errorprice',
                msg: 'Mismatched rates'
            }
        };

    var FORM_DEF = {
        FORM: null,
        FIELDS: {},
        SUBLIST: {},
        initialize: function () {
            var logTitle = [LogTitle, 'FORM_DEF::initialize'].join('::'),
                returnValue;

            var ChargesDEF = BILLPROC.CFG.ChargesDEF,
                Charges = BILLPROC.CHARGES,
                IsBillable = BILLPROC.STATUS.PO && BILLPROC.STATUS.PO.IsBillable,
                Total = BILLPROC.TOTAL,
                arrLineErrors = [];

            try {
                // Collect all the errors
                (BILLPROC.BILLFILE.LINES || []).forEach(function (billfile) {
                    arrLineErrors = arrLineErrors.concat(billfile.ErrorList || []);
                    arrLineErrors = arrLineErrors.concat(billfile.VarianceList || []);
                });

                // get the line errors
                // INITIALIZE OUR FIELDS ///
                FORM_DEF.FIELDS = {
                    SUITELET_URL: {
                        id: 'custpage_suitelet_url',
                        type: ns_ui.FieldType.TEXT,
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        label: 'Suitelet URL',
                        defaultValue: Current.UI.Url
                    },
                    BILLFILE_URL: {
                        id: 'custpage_bill_file',
                        type: ns_ui.FieldType.TEXT,
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        label: 'Bill File',
                        defaultValue: Current.BILLFILE.Url
                    },
                    TASK: {
                        id: 'taskact',
                        type: ns_ui.FieldType.TEXT,
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        label: 'Task',
                        defaultValue: Current.UI.Task
                    },
                    BILLFILE_ID: {
                        id: 'record_id',
                        type: ns_ui.FieldType.TEXT,
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        label: 'Task',
                        defaultValue: Current.BILLFILE.ID
                    },
                    SCRIPTLOADER_URL: {
                        id: 'custpage_scriptloader_url',
                        type: ns_ui.FieldType.TEXT,
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        label: 'Script Loader URL',
                        defaultValue: ns_url.resolveScript({
                            scriptId: vc2_constant.SCRIPT.SCRIPT_LOADER_SL,
                            deploymentId: vc2_constant.DEPLOYMENT.SCRIPT_LOADER_SL,
                            params: {
                                loadact: 'trigger',
                                loadscriptid: 'billprocess-mr',
                                billfileid: Current.BILLFILE.ID,
                                ponum: BILLPROC.BILLFILE.DATA.POID,
                                invnum: BILLPROC.BILLFILE.DATA.BILL_NUM
                            }
                        })
                    }
                };
                /// MAIN ACTIONS ///
                ns_util.extend(FORM_DEF.FIELDS, {
                    ACTION: {
                        id: 'custpage_action',
                        type: ns_ui.FieldType.SELECT,
                        label: 'Action',
                        selectOptions: (function (billStatus) {
                            var selectElems = [FLEXFORM_ACTION.SAVE];

                            // bill file is already processed or closed,
                            if (
                                BILLPROC.STATUS.BILLFILE.IsProcessed ||
                                BILLPROC.STATUS.BILLFILE.IsClosed
                            ) {
                                // Offer the reprocess, if:
                                //  - bill link is empty
                                //  - po is not fully billed
                                //  - items are
                                if (
                                    !BILLPROC.BILLFILE.DATA.BILL_LINK ||
                                    !BILLPROC.STATUS.PO.IsFullyBilled ||
                                    !BILLPROC.STATUS.BILLFILE.ItemsAllBilled
                                )
                                    selectElems.push(FLEXFORM_ACTION.RENEW);
                            }
                            // the PO is already fully billed, or all items are billed
                            else if (
                                BILLPROC.STATUS.PO.IsFullyBilled ||
                                BILLPROC.STATUS.BILLFILE.ItemsAllBilled
                            ) {
                                selectElems.push(FLEXFORM_ACTION.CLOSE);
                            }

                            // the Bill has errors
                            else if (BILLPROC.STATUS.HasErrors) {
                                selectElems.push(FLEXFORM_ACTION.CLOSE);

                                if (
                                    !vc2_util.inArray(billStatus, [
                                        BILL_CREATOR.Status.PENDING,
                                        BILL_CREATOR.Status.REPROCESS
                                    ])
                                ) {
                                    selectElems.push(FLEXFORM_ACTION.REPROCESS);
                                }
                            }
                            // bill has variance
                            else if (BILLPROC.STATUS.HasVariance) {
                                selectElems.push(
                                    FLEXFORM_ACTION.REPROCESS_HASVAR,
                                    FLEXFORM_ACTION.REPROCESS_NOVAR,
                                    FLEXFORM_ACTION.CLOSE
                                );
                            }

                            return selectElems;
                        })(BILLPROC.BILLFILE.DATA.STATUS)
                    },
                    ACTIVE_EDIT: {
                        id: 'custpage_chk_activedit',
                        type: ns_ui.FieldType.CHECKBOX,
                        label: 'IS Active Edit',
                        displayType: ns_ui.FieldDisplayType.HIDDEN,
                        defaultValue: Current.UI.IsActiveEdit ? 'T' : 'F'
                    },
                    PROCESS_VARIANCE: {
                        id: 'custpage_chk_variance',
                        type: ns_ui.FieldType.CHECKBOX,
                        label: 'Process Variance',
                        displayType:
                            BILLPROC.STATUS.BILLFILE.AllowVariance &&
                            !BILLPROC.STATUS.BILLFILE.IgnoreVariance
                                ? ns_ui.FieldDisplayType.INLINE
                                : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: BILLPROC.BILLFILE.DATA.PROC_VARIANCE ? 'T' : 'F'
                    },
                    IGNORE_VARIANCE: {
                        id: 'custpage_chk_ignorevariance',
                        type: ns_ui.FieldType.CHECKBOX,
                        label: 'Ignore Variance',
                        displayType:
                            BILLPROC.STATUS.BILLFILE.IgnoreVariance &&
                            !BILLPROC.STATUS.BILLFILE.AllowVariance
                                ? ns_ui.FieldDisplayType.INLINE
                                : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: BILLPROC.BILLFILE.JSON.ignoreVariance ? 'T' : 'F'
                    },
                    IS_RCVBLE: {
                        id: 'custpage_chk_isreceivable',
                        type: ns_ui.FieldType.CHECKBOX,
                        label: 'Is Receivable',
                        displayType: BILLPROC.STATUS.BILLFILE.AllowToReceive
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: BILLPROC.BILLFILE.DATA.IS_RCVBLE ? 'T' : 'F'
                    }
                });

                // BILL FILE INFO ///
                ns_util.extend(FORM_DEF.FIELDS, {
                    INTEGRATION: {
                        id: 'custpage_integration',
                        type: ns_ui.FieldType.SELECT,
                        source: 'customrecord_vc_bill_vendor_config',
                        label: 'Integration',
                        // breakType: ns_ui.FieldBreakType.STARTCOL,
                        defaultValue: BILLPROC.BILLFILE.DATA.INTEGRATION
                    },
                    STATUS: {
                        id: 'custpage_status',
                        type: ns_ui.FieldType.SELECT,
                        source: 'customlist_ctc_vc_bill_statuses',
                        label: 'Status',
                        defaultValue: BILLPROC.BILLFILE.DATA.STATUS
                    },
                    PROCESS_LOG_TOP: {
                        id: 'custpage_logs_top',
                        type: ns_ui.FieldType.TEXTAREA,
                        label: 'Latest Log Message',

                        defaultValue: (function (data) {
                            var content = data;
                            try {
                                content = JSON.parse(data);
                                content = JSON.stringify(content, null, '\t');
                            } catch (err) {
                                content = data || '';
                            }
                            return [
                                '<div class="uir-field-wrapper uir-long-text" data-field-type="textarea" style="width:20%;">',
                                '<textarea cols="50" rows="3" disabled="true" ',
                                'style="border:none; color: #333 !important; background-color: #FFF !important;">',
                                content.split(/\n/g).pop(),
                                '</textarea>',
                                '</div>'
                            ].join(' ');
                        })(BILLPROC.BILLFILE.DATA.PROCESS_LOG)
                        // defaultValue: (function (logs) {
                        //     return logs.split(/\n/g).pop();
                        // })(BILLPROC.BILLFILE.DATA.PROCESS_LOG)
                    },
                    BILL_FILE_LINK: {
                        id: 'custpage_bill_file_link',
                        type: ns_ui.FieldType.INLINEHTML,
                        label: 'Bill File Link',
                        displayType: ns_ui.FieldDisplayType.INLINE,
                        defaultValue:
                            '<span class="smallgraytextnolink uir-label" style="width:80%;">' +
                            '<span class="smallgraytextnolink">Bill File</span>' +
                            '</span>' +
                            '<span class="uir-field inputreadonly">' +
                            '<span class="inputreadonly">' +
                            ('<a class="dottedlink" href="' +
                                Current.BILLFILE.Url +
                                '" target="_blank">' +
                                (function (str, max) {
                                    return str.length > max ? str.substr(0, max) + '...' : str;
                                })(BILLPROC.BILLFILE.DATA.NAME, 50) +
                                '</a>') +
                            '</span>' +
                            '</span>'
                    },
                    PROCESS_LOGS: {
                        id: 'custpage_logs',
                        type: ns_ui.FieldType.LONGTEXT,
                        label: 'Processing Logs',
                        displayType: ns_ui.FieldDisplayType.INLINE,
                        defaultValue: BILLPROC.BILLFILE.DATA.PROCESS_LOG
                    },
                    BILLFILE_SOURCE: {
                        id: 'custpage_payload',
                        type: ns_ui.FieldType.INLINEHTML,
                        label: 'SOURCE DATA',
                        displayType: ns_ui.FieldDisplayType.INLINE,
                        defaultValue: (function (data) {
                            var content = data;
                            try {
                                content = JSON.parse(data);
                                content = JSON.stringify(content, null, '\t');
                            } catch (err) {
                                content = data;
                            }
                            return [
                                '<div class="uir-field-wrapper uir-long-text" data-field-type="textarea">',
                                '<span class="smallgraytextnolink uir-label">',
                                '<span class="smallgraytextnolink">',
                                '<a class="smallgraytextnolink">SOURCE DATA</a>',
                                '</span></span>',
                                '<textarea cols="60" rows="10" disabled="true" ',
                                'style="padding: 5px 10px; margin: 5px; border:1px solid #CCC !important; color: #363636 !important;">',
                                content,
                                '</textarea>',
                                '</div>'
                            ].join(' ');
                        })(BILLPROC.BILLFILE.DATA.SOURCE)
                    },
                    BILLFILE_JSON: {
                        id: 'custpage_json',
                        type: ns_ui.FieldType.INLINEHTML,
                        label: 'JSON DATA',
                        displayType: ns_ui.FieldDisplayType.INLINE,
                        defaultValue: (function (data) {
                            var content = data;
                            try {
                                content = JSON.parse(data);
                                content = JSON.stringify(content, null, '\t');
                            } catch (err) {
                                content = data;
                            }
                            return [
                                '<div class="uir-field-wrapper uir-long-text" data-field-type="textarea">',
                                '<span class="smallgraytextnolink uir-label">',
                                '<span class="smallgraytextnolink">',
                                '<a class="smallgraytextnolink">CONVERTED DATA</a>',
                                '</span></span>',
                                '<textarea cols="60" rows="10" disabled="true" ',
                                'style="padding: 5px 10px; margin: 5px; border:1px solid #CCC !important; color: #363636 !important;">',
                                content,
                                '</textarea>',
                                '</div>'
                            ].join(' ');
                        })(BILLPROC.BILLFILE.DATA.JSON)
                    },
                    HOLD_REASON: {
                        id: 'custpage_hold_reason',
                        type: ns_ui.FieldType.SELECT,
                        source: 'customlist_ctc_vc_bill_hold_rsns',
                        label: 'Hold Reason',
                        displayType: Current.UI.IsActiveEdit
                            ? ns_ui.FieldDisplayType.NORMAL
                            : ns_ui.FieldDisplayType.INLINE,
                        defaultValue: BILLPROC.BILLFILE.DATA.HOLD_REASON
                    },
                    NOTES: {
                        id: 'custpage_processing_notes',
                        type: ns_ui.FieldType.TEXTAREA,
                        label: 'Notes',
                        displayType: ns_ui.FieldDisplayType.NORMAL,
                        defaultValue: BILLPROC.BILLFILE.DATA.NOTES
                    },
                    INV_NUM: {
                        id: 'custpage_invnum',
                        type: ns_ui.FieldType.TEXT,
                        label: 'Invoice #',
                        defaultValue: BILLPROC.BILLFILE.DATA.BILL_NUM
                    },
                    INV_LINK: {
                        id: 'custpage_invlink',
                        type: ns_ui.FieldType.SELECT,
                        source: 'transaction',
                        label: 'Bill Link',
                        defaultValue: BILLPROC.BILLFILE.DATA.BILL_LINK
                    },
                    INV_DATE: {
                        id: 'custpage_invdate',
                        type: ns_ui.FieldType.DATE,
                        label: 'Invoice Date',
                        defaultValue: BILLPROC.BILLFILE.DATA.DATE
                    },
                    INV_DUEDATE: {
                        id: 'custpage_invduedate',
                        type: ns_ui.FieldType.DATE,
                        label: 'Due Date',
                        defaultValue: BILLPROC.BILLFILE.DATA.DUEDATE
                    },
                    INV_DUEDATE_FILE: {
                        id: 'custpage_invddatefile',
                        type: ns_ui.FieldType.CHECKBOX,
                        label: 'Due Date From File',
                        defaultValue: BILLPROC.BILLFILE.DATA.DDATE_INFILE
                    },
                    INV_TOTAL: {
                        id: 'custpage_invtotal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Invoice Total',
                        defaultValue: BILLPROC.BILLFILE.JSON.total
                    },
                    INV_TAX: {
                        id: 'custpage_invtax',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Charges (Tax)',
                        displayType: ChargesDEF.tax.enabled
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Charges.tax
                    },
                    INV_SHIPPING: {
                        id: 'custpage_invshipping',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Charges (Shipping)',
                        displayType: ChargesDEF.shipping.enabled
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Charges.shipping
                    },
                    INV_OTHER: {
                        id: 'custpage_invothercharge',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Charges (Other)',
                        displayType: ChargesDEF.other.enabled
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Charges.other
                    },
                    INV_MISCCHARGE: {
                        id: 'custpage_invmisccharge',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Charges (Misc)',
                        displayType:
                            ChargesDEF.miscCharges && ChargesDEF.miscCharges.enabled
                                ? ns_ui.FieldDisplayType.INLINE
                                : ns_ui.FieldDisplayType.DISABLED,

                        defaultValue: (function (charges) {
                            var chargeAmt = 0;
                            if (!charges) return chargeAmt;
                            charges.forEach(function (charge) {
                                chargeAmt = (chargeAmt || 0) + vc2_util.parseFloat(charge.amount);
                                return true;
                            });
                            return chargeAmt;
                        })(Charges.miscCharges)
                    },
                    VARIANCE_AMT: {
                        id: 'custpage_varianceamt',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Variance Amount',
                        displayType: ns_ui.FieldDisplayType.INLINE,
                        defaultValue: BILLPROC.BILLFILE.VARAMT
                    }
                });

                // PO FIELDS ////
                ns_util.extend(FORM_DEF.FIELDS, {
                    PO_NUM: {
                        id: 'custpage_ponum',
                        type: ns_ui.FieldType.TEXT,
                        label: 'PO #',
                        defaultValue: BILLPROC.BILLFILE.DATA.POID
                    },
                    PO_LINK: {
                        id: 'custpage_polink',
                        type: ns_ui.FieldType.SELECT,
                        label: 'PO Link',
                        source: 'transaction',
                        defaultValue: BILLPROC.BILLFILE.DATA.PO_LINK
                    },
                    PO_VENDOR: {
                        id: 'custpage_povendor',
                        type: ns_ui.FieldType.SELECT,
                        source: 'vendor',
                        label: 'Vendor',
                        defaultValue: BILLPROC.PO.DATA ? BILLPROC.PO.DATA.entity : ''
                    },
                    PO_LOCATION: {
                        id: 'custpage_polocation',
                        type: ns_ui.FieldType.TEXT,
                        label: 'Location',
                        defaultValue: BILLPROC.PO.DATA ? BILLPROC.PO.DATA.location : ''
                    },
                    PO_STATUS: {
                        id: 'custpage_postatus',
                        type: ns_ui.FieldType.TEXT,
                        label: 'PO Status',
                        defaultValue: BILLPROC.PO.DATA ? BILLPROC.PO.DATA.status : ''
                    },
                    PO_TOTAL: {
                        id: 'custpage_pototal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'PO Total',
                        defaultValue: BILLPROC.PO.DATA ? BILLPROC.PO.DATA.total : ''
                    }
                });

                ns_util.extend(FORM_DEF.FIELDS, {
                    CALC_TOTAL: {
                        id: 'custpage_calctotal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Bill Amount',
                        displayType: IsBillable
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Helper.roundOff(Total.BILL_TOTAL || '')
                    },
                    CALC_TAXTOTAL: {
                        id: 'custpage_polinetaxtotal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Tax',
                        displayType: IsBillable
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Helper.roundOff(Total.BILL_LINETAX)
                    },
                    CALC_SHIPTOTAL: {
                        id: 'custpage_poshiptotal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Shipping ',
                        displayType: IsBillable
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Helper.roundOff(Total.SHIPPING)
                    },
                    CALC_VARIANCETOTAL: {
                        id: 'custpage_variancetotal',
                        type: ns_ui.FieldType.CURRENCY,
                        label: 'Variance',
                        displayType: IsBillable
                            ? ns_ui.FieldDisplayType.INLINE
                            : ns_ui.FieldDisplayType.DISABLED,
                        defaultValue: Helper.roundOff(Total.VARIANCE)
                    }
                });

                // INTIIALIZE SUBLSIT-ITEMS ////
                FORM_DEF.SUBLIST.ITEM = {
                    id: 'item',
                    label: 'Bill Lines',
                    type: ns_ui.SublistType.LIST,
                    fields: {
                        erroritem: null,
                        item: { type: ns_ui.FieldType.TEXT, label: 'Item' },
                        nsitem: {
                            type: ns_ui.FieldType.SELECT,
                            label: 'NS Item',
                            displayType: Current.UI.IsActiveEdit
                                ? ns_ui.FieldDisplayType.ENTRY
                                : ns_ui.FieldDisplayType.INLINE,
                            // select options -- get all items from PO
                            selectOptions: (function (recordLines) {
                                var arrOptions = [{ text: ' ', value: '' }];
                                if (vc2_util.isEmpty(recordLines)) return arrOptions;

                                var itemColl = {};

                                recordLines.forEach(function (lineData) {
                                    if (!itemColl[lineData.item]) {
                                        itemColl[lineData.item] = lineData;
                                        arrOptions.push({
                                            value: lineData.item,
                                            text: lineData.item_text
                                        });
                                    }
                                });
                                return arrOptions;
                            })(BILLPROC.PO.LINES)
                        },
                        nsqty: {
                            label: 'NS Qty',
                            type: ns_ui.FieldType.CURRENCY,
                            align: ns_ui.LayoutJustification.CENTER
                        },
                        nsrcvd: {
                            label: 'Rcvd',
                            // displayType: ns_ui.FieldDisplayType.HIDDEN,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        errorrecived: null,
                        nsbilled: {
                            label: 'Billed',
                            // displayType: ns_ui.FieldDisplayType.HIDDEN,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        errorbilled: null,
                        remainingqty: {
                            label: 'Avail Qty',
                            displayType: Current.UI.IsActiveEdit
                                ? ns_ui.FieldDisplayType.INLINE
                                : ns_ui.FieldDisplayType.HIDDEN,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        quantity: {
                            label: 'Bill Qty',
                            type: ns_ui.FieldType.CURRENCY,
                            displayType: Current.UI.IsActiveEdit
                                ? ns_ui.FieldDisplayType.ENTRY
                                : ns_ui.FieldDisplayType.INLINE,
                            size: { w: 5, h: 100 }
                        },
                        errorqty: null,
                        nsrate: {
                            label: 'NS Rate',
                            type: ns_ui.FieldType.CURRENCY
                        },
                        rate: {
                            label: 'Bill Rate',
                            type: ns_ui.FieldType.CURRENCY,
                            size: { w: 10, h: 100 },
                            displayType: Current.UI.IsActiveEdit
                                ? ns_ui.FieldDisplayType.ENTRY
                                : ns_ui.FieldDisplayType.INLINE
                        },
                        errorprice: null,
                        diffamount: {
                            label: 'Diff',
                            displayType: ns_ui.FieldDisplayType.INLINE,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        amount: {
                            label: 'Bill Amount',
                            totallingField: true,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        calcamount: {
                            label: 'Calc Amount',
                            displayType: ns_ui.FieldDisplayType.HIDDEN,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        nstaxamt: {
                            label: 'Calc. Tax',
                            displayType: ns_ui.FieldDisplayType.INLINE,
                            type: ns_ui.FieldType.CURRENCY
                        },
                        description: {
                            label: 'Description',
                            type: ns_ui.FieldType.TEXT
                        },
                        // line_key: {
                        //     label: 'LineKey',
                        //     type: ns_ui.FieldType.TEXT,
                        //     displayType: ns_ui.FieldDisplayType.NORMAL
                        // },
                        line_idx: {
                            label: 'LineIdx',
                            type: ns_ui.FieldType.TEXT,
                            displayType: ns_ui.FieldDisplayType.NORMAL
                            // displayType: DEBUG_MODE
                            //     ? ns_ui.FieldDisplayType.NORMAL
                            //     : ns_ui.FieldDisplayType.HIDDEN
                        },
                        matchedlines: {
                            label: 'Bill Lines',
                            type: ns_ui.FieldType.TEXT,
                            displayType: DEBUG_MODE
                                ? ns_ui.FieldDisplayType.NORMAL
                                : ns_ui.FieldDisplayType.HIDDEN
                        }
                    }
                };

                arrLineErrors = vc2_util.uniqueArray(arrLineErrors);

                vc2_util.log(logTitle, '// line errors (1): ', arrLineErrors);
                arrLineErrors.forEach(function (errorCode) {
                    if (!BILLPROC.STATUS.BILLFILE.IsActiveEdit) return;
                    var lineErrorDef = LINE_ERROR_MSG[errorCode],
                        sublistField =
                            lineErrorDef && lineErrorDef.col
                                ? FORM_DEF.SUBLIST.ITEM.fields.hasOwnProperty(lineErrorDef.col)
                                : null;

                    // vc2_util.log(logTitle, '..error: ', [
                    //     errorCode,
                    //     LINE_ERROR_MSG,
                    //     lineErrorDef,
                    //     sublistField
                    // ]);
                    if (!lineErrorDef || !sublistField) return;
                    //set the field def

                    FORM_DEF.SUBLIST.ITEM.fields[lineErrorDef.col] = {
                        type: ns_ui.FieldType.TEXT,
                        size: { w: 3, h: 100 },
                        label: ' '
                    };
                    return true;
                });

                // INTIIALIZE SUBLSIT-VARIANCE LINES ////
                FORM_DEF.SUBLIST.CHARGES = {
                    id: 'charges_list',
                    label: 'Charges',
                    type: ns_ui.SublistType.LIST,
                    fields: {
                        is_active: {
                            label: 'Enabled',
                            type: ns_ui.FieldType.CHECKBOX,
                            displayType: ns_ui.FieldDisplayType.INLINE
                            // Current.UI.isActiveEdit ||
                            // BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.VARIANCE
                            //     ? ns_ui.FieldDisplayType.ENTRY
                            //     :
                        },
                        applied: {
                            label: 'Apply',
                            type: ns_ui.FieldType.CHECKBOX,
                            displayType:
                                Current.UI.IsActiveEdit ||
                                BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.VARIANCE
                                    ? ns_ui.FieldDisplayType.ENTRY
                                    : ns_ui.FieldDisplayType.INLINE
                        },
                        type: {
                            label: 'Type',
                            type: ns_ui.FieldType.TEXT,
                            displayType: ns_ui.FieldDisplayType.HIDDEN
                        },
                        name: {
                            label: 'Type',
                            type: ns_ui.FieldType.TEXT
                        },
                        itemname: {
                            label: 'Item',
                            type: ns_ui.FieldType.TEXT
                        },
                        description: {
                            label: 'Description',
                            type: ns_ui.FieldType.TEXT
                        },
                        nsitem: {
                            label: 'PO Item',
                            type: ns_ui.FieldType.SELECT,
                            displayType:
                                Current.UI.IsActiveEdit ||
                                BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.VARIANCE
                                    ? ns_ui.FieldDisplayType.ENTRY
                                    : ns_ui.FieldDisplayType.INLINE,
                            selectOptions: (function (record) {
                                var arrOptions = [{ text: ' ', value: '' }];

                                for (var varianceType in BILLPROC.CFG.ChargesDEF) {
                                    var varianceInfo = BILLPROC.CFG.ChargesDEF[varianceType];
                                    if (varianceInfo.item) {
                                        arrOptions.push({
                                            value: varianceInfo.item,
                                            text: Helper.getItemName(varianceInfo.item)
                                        });
                                    }
                                }

                                if (!record) return arrOptions;

                                var objItemLines = Helper.getLineItems(record);
                                if (!objItemLines) return arrOptions;

                                for (var lineItem in objItemLines) {
                                    var lineData = objItemLines[lineItem];
                                    arrOptions.push({
                                        value: lineData.item,
                                        text: lineData.item_text
                                    });
                                }

                                return arrOptions;
                            })(BILLPROC.PO.REC)
                        },
                        autoprocess: {
                            label: ' ',
                            type: ns_ui.FieldType.TEXT,
                            displayType: ns_ui.FieldDisplayType.INLINE
                        },
                        amount: {
                            label: 'Charge Amount',
                            type: ns_ui.FieldType.CURRENCY,
                            totallingField: true,
                            displayType: ns_ui.FieldDisplayType.INLINE
                        },
                        calcamount: {
                            label: 'Calc Amount',
                            type: ns_ui.FieldType.CURRENCY,
                            displayType: ns_ui.FieldDisplayType.INLINE
                        },
                        amountvar: {
                            label:
                                'Variance' +
                                (BILLPROC.TOTAL.VARIANCE > 0
                                    ? ' | ' + Helper.roundOff(BILLPROC.TOTAL.VARIANCE).toString()
                                    : ''),
                            type: ns_ui.FieldType.CURRENCY,
                            // totallingField: true,
                            displayType:
                                Current.UI.IsActiveEdit ||
                                BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.VARIANCE
                                    ? ns_ui.FieldDisplayType.ENTRY
                                    : ns_ui.FieldDisplayType.INLINE
                        },
                        amounttax: {
                            label: 'Applied Tax',
                            type: ns_ui.FieldType.CURRENCY,
                            displayType: ns_ui.FieldDisplayType.INLINE
                        }
                    }
                };
            } catch (error) {
                vc2_util.logError(logTitle, error);
                // } finally {
                //     vc2_util.log(logTitle, ' //Initalized Fields: ', FORM_DEF.FIELDS);
                //     vc2_util.log(logTitle, ' //Initalized SUBLIST: ', FORM_DEF.SUBLIST);
            }

            return FORM_DEF.FIELDS;
        }
    };

    ////// MAIN SUITELET ///////
    var Suitelet = {
        onRequest: function (scriptContext) {
            var logTitle = [LogTitle, 'onRequest'].join('::');
            vc2_util.log(logTitle, '############################################');
            vc2_util.log(logTitle, '>> Params: ', scriptContext.request.parameters);

            var currentScript = ns_runtime.getCurrentScript();

            try {
                FlexScreen_UI.initialize(scriptContext);
                logTitle = [LogTitle, Current.UI.Method, Current.BILLFILE.ID].join('::');

                Current.UI.Task = Current.UI.Task || 'loadingPage'; // default is loadingPage

                // set the Form
                FORM_DEF.FORM = ns_ui.createForm({ title: 'Flex Screen' });
                if (currentScript.deploymentId == 'customdeploy_vc_bill_creator_flex_screen')
                    FORM_DEF.FORM.clientScriptModulePath =
                        './Libraries/CTC_VC_Lib_Suitelet_Client_Script';

                vc_uihelper.setUI({ form: FORM_DEF.FORM });
                vc2_util.log(logTitle, '// CURRENT: ', Current);
                if (Current.UI.Method == 'GET') {
                    FlexScreen_UI[Current.UI.Task].call(FlexScreen_UI, scriptContext);
                } else {
                    FlexScreen_UI.postAction(scriptContext);
                }
            } catch (error) {
                vc2_util.logError(logTitle, error);
                FlexScreen_UI.handleError(error);
            } finally {
                scriptContext.response.writePage(FORM_DEF.FORM);
            }

            return true;
        }
    };
    ////////////////////////////

    /// FLEX SCREEN CONTROLLER ////
    ///////////////////////////////
    var FlexScreen_UI = {
        initialize: function (scriptContext) {
            var logTitle = [LogTitle, 'initialize'].join('::'),
                returnValue;

            Current.BILLFILE.ID = scriptContext.request.parameters.record_id;
            Current.UI.Task = scriptContext.request.parameters.taskact || '';
            Current.UI.Method = scriptContext.request.method.toUpperCase();
            Current.UI.Script = ns_runtime.getCurrentScript();

            /// LICENSE CHECK /////
            var license = vcs_configLib.validateLicense();

            // immediately exit, if the license is not valid
            if (license.hasError) {
                Current.MSG.error.push(vc2_constant.ERRORMSG.INVALID_LICENSE.message);
                Current.UI.IsActiveEdit = false;
                return false;
            }

            return returnValue;
        },
        preprocessBill: function (scriptContext) {
            var logTitle = [LogTitle, 'preprocessBill'].join('::'),
                returnValue;

            /// PRE LOAD THE BILL FILE ////
            BILLPROC = vc_billprocess.preprocessBill({ billFileId: Current.BILLFILE.ID });

            Current.BILLFILE.Url = ns_url.resolveRecord({
                recordType: 'customrecord_ctc_vc_bills',
                recordId: Current.BILLFILE.ID
            });
            Current.UI.Url = ns_url.resolveScript({
                scriptId: ns_runtime.getCurrentScript().id,
                deploymentId: ns_runtime.getCurrentScript().deploymentId,
                params: {
                    record_id: Current.BILLFILE.ID
                    // taskact: Current.UI.Task
                }
            });

            // CHECK for Active Edit
            if (BILLPROC.STATUS.BILLFILE.IsActiveEdit) Current.UI.IsActiveEdit = true;

            var statusInfo = BILLPROC.STATUS,
                poStatus = statusInfo.PO,
                billFileStatus = statusInfo.BILLFILE;

            var errorReport = vc_billprocess.reportError() || {
                errors: [],
                variance: [],
                notes: []
            };

            var canCreateBill = statusInfo.IsBillable && statusInfo.AllowToBill,
                canReceiveBeforeBill = statusInfo.IsReceivable && statusInfo.AllowToReceive,
                hasBlockingIssues =
                    statusInfo.HasVariance || statusInfo.HasErrors || statusInfo.HasCritical,
                messageType = statusInfo.AllowToBill ? 'warning' : 'error',
                notificationMessages = [];

            // Exit early when bill file is no longer actionable.
            if (billFileStatus.IsClosed || billFileStatus.IsProcessed) {
                Current.UI.IsActiveEdit = false;

                Current.MSG[billFileStatus.HasBilled ? 'info' : 'warning'].push(
                    'Bill File is already ' + (billFileStatus.IsClosed ? 'closed' : 'processed')
                );
                return;
            }

            // Exit early when the source PO is no longer actionable.
            if (poStatus.IsFullyBilled || poStatus.IsClosed) {
                Current.UI.IsActiveEdit = false;

                Current.MSG.error.push(
                    poStatus.IsClosed ? 'PO is already closed' : 'PO is already fully billed.'
                );
                return;
            }

            if (billFileStatus.ItemsAllBilled) {
                Current.UI.IsActiveEdit = false;
                Current.MSG.error.push('Items on this bill are already fully billed');
                return;
            }

            // Happy path: no blockers and we can bill now (or receive then bill).
            if (!hasBlockingIssues && (canCreateBill || canReceiveBeforeBill)) {
                Current.UI.IsActiveEdit = true;

                Current.MSG.info.push(
                    canCreateBill ? 'Bill will be created' : 'PO will be fulfilled, then billed'
                );
                return;
            }

            // Critical errors suppress variance/note details to avoid noisy messaging.
            var errorBuckets = ['errors'];
            if (!statusInfo.HasCritical) errorBuckets.push('variance', 'notes');

            errorBuckets.forEach(function (bucket) {
                if (!vc2_util.isEmpty(errorReport[bucket])) {
                    notificationMessages.push(errorReport[bucket].join('<br/>'));
                }
            });

            if (statusInfo.HasCritical) Current.UI.IsActiveEdit = false;

            if (!statusInfo.HasCritical && (statusInfo.AllowToBill || statusInfo.AllowToReceive)) {
                if (canReceiveBeforeBill) notificationMessages.push('Fulfillment will be created.');

                if (billFileStatus.AllowVariance) {
                    notificationMessages.push('<br/><b> Bill will be created with variances. </b>');
                } else if (billFileStatus.IgnoreVariance) {
                    notificationMessages.push(
                        '<br/><b> Bill will be created ignoring the variances. </b>'
                    );
                } else if (statusInfo.AllowToBill) {
                    notificationMessages.push('<br/><b> Bill will be created</b>');
                }
            }

            if (!vc2_util.isEmpty(notificationMessages)) {
                Current.MSG[messageType] = Current.MSG[messageType].concat(notificationMessages);
            }
        },
        loadingPage: function (scriptContext) {
            var logTitle = [LogTitle, 'loadingPage'].join('::'),
                returnValue;

            vc2_util.log(logTitle, '// Form Helper? ', FORM_DEF.FORM);

            vc_uihelper.renderFieldList([
                {
                    type: ns_ui.FieldType.INLINEHTML,
                    label: 'Loading',
                    defaultValue: '<h2> Loading bill file...</h2>'
                },
                {
                    id: 'custpage_redir_url',
                    type: ns_ui.FieldType.TEXT,
                    displayType: ns_ui.FieldDisplayType.HIDDEN,
                    label: 'Redir URL',
                    defaultValue: ns_url.resolveScript({
                        scriptId: ns_runtime.getCurrentScript().id,
                        deploymentId: ns_runtime.getCurrentScript().deploymentId,
                        params: {
                            record_id: Current.BILLFILE.ID,
                            taskact: 'viewForm'
                        }
                    })
                }
            ]);

            return true;
        },
        viewForm: function (scriptContext) {
            var logTitle = [LogTitle, 'viewForm'].join('::'),
                returnValue;

            FlexScreen_UI.preprocessBill(scriptContext);

            // initialize the fields
            FORM_DEF.initialize();
            vc_uihelper.setUI({ fields: FORM_DEF.FIELDS });
            vc_uihelper.setUI({ sublist: FORM_DEF.SUBLIST });

            /// Buttons //////////////
            var Form = FORM_DEF.FORM;
            Form.addSubmitButton({ label: 'Submit' });
            Form.addResetButton({ label: 'Reset' });

            var btnProcessBill = Form.addButton({
                id: 'btnProcessBill',
                label: 'Process Bill File',
                functionName: 'goToProcessBill'
            });

            if (!Current.UI.IsActiveEdit) btnProcessBill.isDisabled = true;
            if (!BILLPROC.STATUS.AllowToBill) btnProcessBill.isDisabled = true;

            // create the tabs
            Form.addTab({ id: 'tab_items', label: 'Bill Lines' });
            Form.addTab({ id: 'tab_charges', label: 'Charges' });
            Form.addTab({ id: 'tab_logs', label: 'Processing Logs' });
            Form.addTab({ id: 'tab_payload', label: 'Payload Data' });
            Form.addTab({ id: 'tab_notes', label: 'Notes' });

            // HIDDEN FIELDS //
            vc_uihelper.renderFieldList([
                'SUITELET_URL',
                'BILLFILE_URL',
                'TASK',
                'BILLFILE_ID',
                'SCRIPTLOADER_URL'
            ]);

            // Main Actions Fields
            vc_uihelper.renderFieldList([
                'SPACER:STARTCOL',
                'H1: Actions',
                'ACTION',
                'ACTIVE_EDIT',
                'PROCESS_VARIANCE',
                'IGNORE_VARIANCE',
                'IS_RCVBLE',
                'HOLD_REASON',
                'BILL_FILE_LINK'
            ]);
            // BILL FILE INFO
            vc_uihelper.renderFieldList([
                'SPACER:STARTCOL',
                'H1: BILL INFO',
                'INTEGRATION',
                'STATUS',
                'INV_NUM',
                'INV_DATE',
                BILLPROC.STATUS.BILLFILE.IsProcessed ? 'INV_LINK' : '',
                'INV_TOTAL',
                'INV_TAX',
                'INV_SHIPPING',
                'INV_OTHER',
                'SPACER'
            ]);

            // PO DATA
            vc_uihelper.renderFieldList([
                'SPACER:STARTCOL',
                'H1: PO DATA',
                'PO_NUM',
                'PO_LINK',
                'PO_STATUS',
                'PO_VENDOR',
                'PO_LOCATION',
                'PO_TOTAL'
            ]);

            // CALC TOTALS
            if (
                (BILLPROC.STATUS.BILLFILE.IsProcessed ||
                    BILLPROC.STATUS.PO.IsFullyBilled ||
                    BILLPROC.STATUS.BILLFILE.IsClosed) &&
                BILLPROC.BILLFILE &&
                BILLPROC.BILLFILE.DATA.BILL_LINK
            ) {
                // vc_uihelper.renderFieldList([
                //     'SPACER:STARTCOL',
                //     'H1: BILL TOTAL',
                //     'CALC_TOTAL',
                //     'CALC_TAXTOTAL',
                //     'CALC_SHIPTOTAL',
                //     'CALC_VARIANCETOTAL'
                // ]);
            } else {
                vc_uihelper.renderFieldList([
                    'SPACER:STARTCOL',
                    'H1: CALC TOTAL',
                    'CALC_TOTAL',
                    'CALC_TAXTOTAL',
                    'CALC_SHIPTOTAL',
                    'CALC_VARIANCETOTAL'
                ]);
            }

            vc_uihelper.renderField(
                vc2_util.extend(FORM_DEF.FIELDS.PROCESS_LOGS, { container: 'tab_logs' })
            );
            vc_uihelper.renderField(
                vc2_util.extend(FORM_DEF.FIELDS.BILLFILE_SOURCE, { container: 'tab_payload' })
            );
            vc_uihelper.renderField(
                vc2_util.extend(FORM_DEF.FIELDS.BILLFILE_JSON, { container: 'tab_payload' })
            );
            vc_uihelper.renderField(
                vc2_util.extend(FORM_DEF.FIELDS.NOTES, { container: 'tab_notes' })
            );

            // vc2_util.log(logTitle, '/// BILL FILE LINES: ', BILLPROC.BILLFILE.LINES);
            var itemSublist = vc_uihelper.renderSublist(
                vc2_util.extend({ tab: 'tab_items' }, FORM_DEF.SUBLIST.ITEM)
            );

            // Fixed: render bill lines in LINEIDX order so the flex screen matches source line sequencing.
            (BILLPROC.BILLFILE.LINES || []).sort(function (leftLine, rightLine) {
                var leftIdx = vc2_util.parseFloat(leftLine.LINEIDX || leftLine.lineIdx || 0),
                    rightIdx = vc2_util.parseFloat(rightLine.LINEIDX || rightLine.lineIdx || 0);

                return leftIdx - rightIdx;
            });

            // add the bill lines
            (BILLPROC.BILLFILE.LINES || []).forEach(function (billLine, lineIdx) {
                var lineData = {
                    item: billLine.itemName,
                    nsitem: billLine.itemId,
                    quantity: billLine.quantity,
                    rate: billLine.rate,
                    amount: billLine.amount,
                    description: billLine.description,
                    line_idx: billLine.lineIdx || billLine.LINEIDX,
                    // line_key: billLine.LINE_KEY,
                    nstaxamt: billLine.TotalLineTax,
                    calcamount: Helper.roundOff(billLine.quantity * billLine.rate)
                };

                if (!vc2_util.isEmpty(billLine.OrderLine)) {
                    ns_util.extend(lineData, {
                        nsqty: billLine.OrderLine.quantity,
                        nsrcvd: billLine.OrderLine.quantityreceived,
                        nsbilled: billLine.OrderLine.quantitybilled,
                        nsrate: billLine.OrderLine.rate,
                        remainingqty: billLine.OrderLine.BILLABLE
                            ? billLine.OrderLine.BILLABLE
                            : billLine.OrderLine.RECEIVABLE || '',
                        nstaxamt: Helper.roundOff(billLine.OrderLine.APPLIEDTAX)
                    });
                    lineData.diffamount =
                        lineData.calcamount - Helper.roundOff(lineData.nsrate * billLine.quantity);
                }

                // vc2_util.log(logTitle, '// bill line: ', billLine);

                var arrLineErrors = [];
                arrLineErrors = arrLineErrors.concat(billLine.ErrorList || []);
                arrLineErrors = arrLineErrors.concat(billLine.VarianceList || []);

                arrLineErrors.forEach(function (errorCode) {
                    var lineError = LINE_ERROR_MSG[errorCode];
                    if (!lineError) return false;

                    var css = [
                        'text-decoration:none;',
                        'color:red;',
                        'background-color:#faf1f1;',
                        'padding:0'
                        // 'margin:2px 2px 0 0;'
                    ].join('');

                    lineData[lineError.col] =
                        '<div style="font-weight:bold; color:red;font-size:1.2em;text-align:left;margin:auto;width:100%;">' +
                        '<a href="javascript:void(0);" ' +
                        ('style="' + css + '"') +
                        (' title="' + lineError.msg + '">') +
                        '&nbsp ! &nbsp;' +
                        '</a></div>';

                    return true;
                });

                // vc2_util.log(logTitle, '// set sublist line', lineData);
                vc_uihelper.setSublistValues({
                    sublist: itemSublist,
                    line: lineIdx,
                    lineData: lineData
                });
            });

            var chargesSublist = vc_uihelper.renderSublist(
                vc2_util.extend({ tab: 'tab_charges' }, FORM_DEF.SUBLIST.CHARGES)
            );

            (BILLPROC.CHARGELINES || []).forEach(function (chargeLine, idx) {
                var chargeLineValues = {
                    is_active: chargeLine.enabled ? 'T' : 'F',
                    applied: chargeLine.applied,
                    type: chargeLine.name,
                    description: chargeLine.description,
                    itemname: Helper.getItemName(chargeLine.item),
                    nsitem: chargeLine.item,
                    autoprocess:
                        chargeLine.amount && chargeLine.autoProc
                            ? '<span style="color: red;font-size:1em;"> ** Auto Processed ** </span>'
                            : '',
                    amount: chargeLine.amount || '0.00',
                    calcamount: chargeLine.calcAmount || '0.00',
                    amountvar: chargeLine.varianceAmount || '0.00',
                    amounttax: chargeLine.amounttax || '0.00'
                };

                vc_uihelper.setSublistValues({
                    sublist: chargesSublist,
                    line: idx,
                    lineData: chargeLineValues
                });

                return true;
            });

            // combine the errors and warnings
            if (!vc2_util.isEmpty(Current.MSG.error))
                FORM_DEF.FORM.addPageInitMessage({
                    title: 'Bill not created',
                    message:
                        '<br />' +
                        (ns_util.isArray(Current.MSG.error)
                            ? Current.MSG.error.join('<br />')
                            : Current.MSG.error),
                    type: ns_msg.Type.ERROR
                });
            else if (!vc2_util.isEmpty(Current.MSG.warning)) {
                FORM_DEF.FORM.addPageInitMessage({
                    title: 'Warning',
                    message:
                        '<br />' +
                        (ns_util.isArray(Current.MSG.warning)
                            ? Current.MSG.warning.join('<br />')
                            : Current.MSG.warning),
                    type: ns_msg.Type.WARNING
                });
            }
            if (!vc2_util.isEmpty(Current.MSG.info)) {
                FORM_DEF.FORM.addPageInitMessage({
                    title: 'Information',
                    message:
                        '<br />' +
                        (ns_util.isArray(Current.MSG.info)
                            ? Current.MSG.info.join('<br />')
                            : Current.MSG.info),
                    type: ns_msg.Type.INFORMATION
                });
            }

            return true;
        },
        postAction: function (scriptContext) {
            var logTitle = [LogTitle, 'postAction'].join('::'),
                requestObj = scriptContext.request,
                returnValue;

            BILLPROC = vc_billprocess.preprocessBill({
                billFileId: Current.BILLFILE.ID,
                noBill: true
            });
            FORM_DEF.initialize();

            var FField = FORM_DEF.FIELDS,
                FSublist = FORM_DEF.SUBLIST;
            vc2_util.log(logTitle, '// FField: ', FField);
            vc2_util.log(logTitle, '// FSublist: ', FSublist);

            var paramValues = {
                    billFileId: requestObj.parameters[FField.BILLFILE_ID.id],
                    poLink: requestObj.parameters[FField.PO_LINK.id],
                    action: requestObj.parameters[FField.ACTION.id],
                    notes: requestObj.parameters[FField.NOTES.id],
                    holdReason: requestObj.parameters[FField.HOLD_REASON.id],
                    itemLineCount: requestObj.getLineCount(FSublist.ITEM.id),
                    varianceLineCount: requestObj.getLineCount(FSublist.CHARGES.id)
                },
                updateValues = {},
                ignoreVariance = BILLPROC.STATUS.BILLFILE.IgnoreVariance;

            // Override variance flags based on selected action
            if (paramValues.action == FLEXFORM_ACTION.REPROCESS_NOVAR.value) {
                ignoreVariance = true;
            } else if (paramValues.action == FLEXFORM_ACTION.REPROCESS_HASVAR.value) {
                ignoreVariance = false;
            }

            vc2_util.log(logTitle, '// Param Values: ', paramValues);

            var JSON_DATA = vc2_util.safeParse(BILLPROC.BILLFILE.DATA.JSON) || {};
            JSON_DATA.lines = ns_util.isArray(JSON_DATA.lines) ? JSON_DATA.lines : [];

            // update the item lines
            for (var line = 0; line < paramValues.itemLineCount; line++) {
                var lineData = vc_uihelper.extractLineValues({
                    record: requestObj,
                    groupId: FSublist.ITEM.id,
                    columns: ['nsitem', 'quantity', 'rate', 'nsqty', 'nsrate', 'line_idx'],
                    line: line
                });
                vc2_util.log(logTitle, '... lineData: ', [lineData, line]);

                var lineIdx = parseInt(lineData.line_idx);
                var JSONDataLine = JSON_DATA.lines[lineIdx];
                if (vc2_util.isEmpty(JSONDataLine)) continue;

                ns_util.extend(JSONDataLine, {
                    NSITEM: lineData.nsitem,
                    BILLRATE: lineData.rate,
                    PRICE: lineData.rate,
                    RATE: lineData.rate,
                    APPLIEDRATE: ignoreVariance ? lineData.nsrate : lineData.rate,
                    NSRATE: lineData.nsrate,
                    QUANTITY: lineData.quantity
                });
            }

            // update the variance lines
            JSON_DATA.variance = [];
            for (var line = 0; line < paramValues.varianceLineCount; line++) {
                var lineData = vc_uihelper.extractLineValues({
                    record: requestObj,
                    groupId: FSublist.CHARGES.id,
                    columns: [
                        'applied',
                        'type',
                        'name',
                        'nsitem',
                        'description',
                        'quantity',
                        'rate',
                        'amount'
                    ],
                    line: line
                });
                vc2_util.log(logTitle, '... lineData: ', lineData);
                if (lineData.rate == 0 || lineData.amount == 0) continue;

                JSON_DATA.variance.push({
                    applied: ignoreVariance ? 'F' : lineData.applied,
                    type: lineData.type,
                    item: lineData.nsitem,
                    name: lineData.name,
                    description: lineData.description,
                    rate: lineData.amount,
                    quantity: 1
                });
            }

            var BILLFILE_FIELD = vc2_constant.RECORD.BILLFILE.FIELD;

            updateValues[BILLFILE_FIELD.NOTES] = paramValues.notes;
            updateValues[BILLFILE_FIELD.HOLD_REASON] = paramValues.holdReason;
            updateValues[BILLFILE_FIELD.PO_LINK] = paramValues.poLink;

            var redirectToPO = false;

            if (
                paramValues.holdReason &&
                BILLPROC.BILLFILE.DATA.STATUS != BILL_CREATOR.Status.REPROCESS
            ) {
                paramValues.action = FLEXFORM_ACTION.HOLD.value;
            }

            JSON_DATA.ignoreVariance = ignoreVariance || null;

            switch (paramValues.action) {
                case FLEXFORM_ACTION.REPROCESS_HASVAR.value:
                    updateValues[BILLFILE_FIELD.STATUS] = BILL_CREATOR.Status.REPROCESS;
                    updateValues[BILLFILE_FIELD.PROC_VARIANCE] = 'T';
                    break;
                case FLEXFORM_ACTION.REPROCESS_NOVAR.value:
                    updateValues[BILLFILE_FIELD.STATUS] = BILL_CREATOR.Status.REPROCESS;
                    updateValues[BILLFILE_FIELD.PROC_VARIANCE] = 'F';
                    break;
                case FLEXFORM_ACTION.REPROCESS.value:
                case FLEXFORM_ACTION.RENEW.value:
                    updateValues[BILLFILE_FIELD.STATUS] = BILL_CREATOR.Status.REPROCESS;
                    updateValues[BILLFILE_FIELD.PROC_VARIANCE] = '';
                    break;
                case FLEXFORM_ACTION.CLOSE.value:
                    updateValues[BILLFILE_FIELD.STATUS] = BILL_CREATOR.Status.CLOSED;
                    break;
                case FLEXFORM_ACTION.MANUAL.value:
                    redirectToPO = true;
                    break;
                case FLEXFORM_ACTION.HOLD.value:
                    updateValues[BILLFILE_FIELD.STATUS] = BILL_CREATOR.Status.HOLD;
                    break;
            }
            updateValues[BILLFILE_FIELD.JSON] = JSON.stringify(JSON_DATA);

            vc2_util.log(logTitle, '>>> updateValues: ', updateValues);
            ns_record.submitFields({
                type: vc2_constant.RECORD.BILLFILE.ID,
                id: Current.BILLFILE.ID,
                values: updateValues
            });

            if (redirectToPO) {
                ns_redirect.toRecordTransform({
                    fromId: BILLPROC.PO.ID,
                    fromType: ns_record.Type.PURCHASE_ORDER,
                    toType: ns_record.Type.VENDOR_BILL
                });
            } else {
                ns_redirect.toSuitelet({
                    scriptId: 'customscript_ctc_vc_bill_flex_screen',
                    deploymentId: '1',
                    parameters: {
                        record_id: Current.BILLFILE.ID
                    }
                });
            }
            return returnValue;
        },
        handleError: function (error) {
            var errorMessage = vc2_util.extractError(error);

            FORM_DEF.FORM.addPageInitMessage({
                title: 'Error Found ', // + errorMessage,
                message: errorMessage,
                type: ns_msg.Type.ERROR
            });

            // vc_formHelper.renderField({
            //     id: 'custpage_error_page',
            //     type: ns_ui.FieldType.INLINEHTML,
            //     label: 'Error Message',
            //     defaultValue:
            //         '<p><h1 class="errortextheading tasktitle"><h3>Error message: '+errorMessage+'</h1></p>' +
            //         '<p><div class="errortextheading" style="padding: 5px;">' +
            //         JSON.stringify(error) +
            //         '</div></p>'
            // });

            return true;
        }
    };
    ///////////////////////////////

    /// GENERAL HELPER //////////////
    var Helper = {
        CACHE: {},
        roundOff: function (value, decimals) {
            var flValue = util.isNumber(value) ? value : vc2_util.forceFloat(value || '0');
            if (!flValue || isNaN(flValue)) return 0;
            var precision = Math.pow(10, decimals === undefined ? 3 : decimals);
            return Math.round(flValue * precision) / precision;
        },
        getItemName: function (itemId) {
            var logTitle = [LogTitle, 'getItemName'].join('::'),
                returnValue = '';
            if (!itemId) return returnValue;
            var cacheKey = ['item', itemId].join(':');

            if (!Helper.CACHE.hasOwnProperty(cacheKey)) {
                try {
                    var itemLookup = vc2_util.flatLookup({
                        type: 'item',
                        id: itemId,
                        columns: ['name']
                    });
                    Helper.CACHE[cacheKey] = itemLookup.name;
                } catch (err) {
                    Helper.CACHE[cacheKey] = false;
                    vc2_util.log(logTitle, '## ERROR ##', err);
                }

                // vc2_util.log(logTitle, '>> ITEM ID: ', [itemId, Helper.CACHE[cacheKey]]);
            }

            return Helper.CACHE[cacheKey];
        },
        isBillable: function () {
            var logTitle = [LogTitle, 'isBillable'].join('::'),
                returnValue = true;

            Current.UI.IsBillable = false;
            Current.UI.IsFulfillable = false;
            Current.IS_FULLYBILLED = false;

            try {
                if (!BILLPROC.PO.DATA) throw 'MISSING: PO Data';

                /// If the BillFile is already CLOSED or PROCOSSED,
                ///     OR Bill is already linked, skip
                if (
                    vc2_util.inArray(BILLPROC.BILLFILE.DATA.STATUS, [
                        BILL_CREATOR.Status.PROCESSED,
                        BILL_CREATOR.Status.CLOSED
                    ]) ||
                    BILLPROC.BILLFILE.DATA.BILL_LINK
                )
                    throw 'SKIPPED: BILL FILE is CLOSED or PROCESSED';

                /// if the PO is already Fully Billed or Closed, skip
                if (vc2_util.inArray(BILLPROC.PO.DATA.statusRef, ['fullyBilled', 'closed'])) {
                    Current.MSG.warning.push(
                        'Purchase Order is already ' + BILLPROC.PO.DATA.status
                    );
                    Current.IS_FULLYBILLED = true;
                    throw 'PO is already CLOSED or BILLED';
                }

                if (
                    vc2_util.inArray(BILLPROC.PO.DATA.statusRef, [
                        'pendingReceipt',
                        'partiallyReceived'
                    ])
                ) {
                    // var arrMsg = ['Purchase Order is not ready for billing.'];
                    Current.UI.IsFulfillable =
                        BILLPROC.BILLFILE.DATA.IS_RCVBLE && BILLPROC.CFG.BillCFG.enableFulfillment;

                    if (BILLPROC.CFG.BillCFG.enableFulfillment) {
                        if (BILLPROC.BILLFILE.DATA.IS_RCVBLE) {
                            Current.MSG.info.push(
                                'Purchase Order is ready for fulfillment, then it will be billed'
                            );

                            throw 'Purchase Order is ready for fulfillment, then it will be billed';
                        } else {
                            Current.MSG.warning.push('Bill file is not receivable.');
                            throw 'Bill file is not receivable.';
                        }
                    } else {
                        Current.MSG.warning.push('Purchase Order is not ready for billing.');

                        throw 'Purchase Order is not ready for billing.';
                    }

                    return false;
                }

                /// if PO needs to be received (Pending Receipt, Partially Received)
                Current.UI.IsBillable = true;

                // try to load the BILL record
                if (BILLPROC.PO.REC) {
                    try {
                        Current.BILL.REC = vc2_recordlib.transform({
                            fromType: 'purchaseorder',
                            fromId: BILLPROC.PO.ID,
                            toType: 'vendorbill',
                            isDynamic: true
                        });
                    } catch (bill_err) {
                        returnValue = false;
                        vc2_util.logError(logTitle + '::isBillable?', bill_err);

                        Current.MSG.error.push(
                            'Unable to create Vendor Bill due to: ' +
                                vc2_util.extractError(bill_err)
                        );
                    }
                }
            } catch (error) {
                vc2_util.logError(logTitle, error);
                returnValue = false;
            } finally {
            }

            return returnValue;
        },
        isEditActive: function () {
            var returnValue = false;

            if (!BILLPROC.BILLFILE.DATA) return false; // no bill file, return false;

            var license = vcs_configLib.validateLicense();

            if (license.hasError) {
                Current.MSG.error.push(vc2_constant.ERRORMSG.INVALID_LICENSE.message);
                Current.UI.IsActiveEdit = false;
                return false;
            }

            if (
                vc2_util.inArray(BILLPROC.BILLFILE.DATA.STATUS, [
                    BILL_CREATOR.Status.PENDING,
                    BILL_CREATOR.Status.ERROR,
                    // BILL_CREATOR.Status.CLOSED,
                    BILL_CREATOR.Status.HOLD,
                    BILL_CREATOR.Status.VARIANCE
                ])
            ) {
                returnValue = true;

                // exception on edit mode:
                if (
                    // if the PO is already fully billed
                    Current.IS_FULLYBILLED ||
                    // bill file is already closed, but
                    (!BILLPROC.BILLFILE.DATA.BILL_LINK &&
                        BILLPROC.BILLFILE.DATA.status == BILL_CREATOR.Status.CLOSED)
                ) {
                    returnValue = false;
                }
            }

            if (
                vc2_util.inArray(BILLPROC.BILLFILE.DATA.STATUS, [
                    BILL_CREATOR.Status.ERROR,
                    BILL_CREATOR.Status.HOLD,
                    BILL_CREATOR.Status.VARIANCE
                ])
            ) {
                Current.MSG.warning.push(
                    (BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.VARIANCE
                        ? 'VARIANCE Detected'
                        : BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.ERROR
                          ? 'ERROR Detected'
                          : BILLPROC.BILLFILE.DATA.STATUS == BILL_CREATOR.Status.HOLD
                            ? 'BILL IS ON HOLD'
                            : '') +
                        '\n\n' +
                        (function (logs) {
                            var str = (logs || '').split(/\n/g).pop();
                            return str.replace(/^.*\d{1,2}\/\d{4}/gi, '');
                        })(BILLPROC.BILLFILE.DATA.PROCESS_LOG)
                );
            }

            Current.UI.IsActiveEdit = returnValue;
            return returnValue;
        },
        getLineItems: function (record, filter) {
            if (vc2_util.isEmpty(record)) return false;
            var lineCount = record.getLineCount('item');
            var cacheKey = ['lineItem', record.id, record.type].join(':');
            var objLineItems = Helper.CACHE[cacheKey] || {};

            var DEF_LINEFIELDS = {
                number: ['line', 'item', 'quantity', 'quantityreceived', 'quantitybilled'],
                currency: ['rate', 'amount', 'taxrate1', 'taxrate2'],
                list: ['item']
            };

            if (!Helper.CACHE.hasOwnProperty(cacheKey)) {
                var lineFields = [
                    'item',
                    'rate',
                    'quantity',
                    'amount',
                    'quantityreceived',
                    'quantitybilled',
                    'taxrate1',
                    'taxrate2'
                ];

                for (var line = 0; line < lineCount; line++) {
                    var lineData = { line: line },
                        isSkipped = false;

                    for (var i = 0, j = lineFields.length; i < j; i++) {
                        var field = lineFields[i],
                            fieldValue = record.getSublistValue({
                                sublistId: 'item',
                                fieldId: field,
                                line: line
                            });

                        if (vc2_util.inArray(field, DEF_LINEFIELDS.number))
                            fieldValue = vc2_util.forceInt(fieldValue);
                        if (vc2_util.inArray(field, DEF_LINEFIELDS.currency))
                            fieldValue = vc2_util.parseFloat(fieldValue);
                        lineData[field] = fieldValue;

                        if (vc2_util.inArray(field, DEF_LINEFIELDS.list))
                            lineData[field + '_text'] = record.getSublistText({
                                sublistId: 'item',
                                fieldId: field,
                                line: line
                            });

                        //// FILTERS ///////////
                        if (!vc2_util.isEmpty(filter) && filter.hasOwnProperty(field)) {
                            if (filter[field] != fieldValue) {
                                isSkipped = true;
                                break;
                            }
                        }
                        ////////////////////////
                    }
                    if (isSkipped) continue;
                    if (!objLineItems[lineData.item]) {
                        objLineItems[lineData.item] = lineData;
                    } else {
                        objLineItems[lineData.item].quantity += lineData.quantity;
                        objLineItems[lineData.item].quantityreceived += lineData.quantityreceived;
                        objLineItems[lineData.item].quantitybilled += lineData.quantitybilled;
                    }
                }

                for (var lineItem in objLineItems) {
                    objLineItems[lineItem].amount =
                        objLineItems[lineItem].quantity * objLineItems[lineItem].rate;

                    objLineItems[lineItem].amount = Helper.roundOff(objLineItems[lineItem].amount);
                }

                Helper.CACHE[cacheKey] = objLineItems;
            }

            return objLineItems;
        },
        extractBillLineErrors: function (option) {
            var billLines = option.billLines || [];

            var arrLineErrors = [];
            billLines.forEach(function (billLine) {
                return true;
            });
        }
    };
    ///////////////////////////////

    return Suitelet;
});
