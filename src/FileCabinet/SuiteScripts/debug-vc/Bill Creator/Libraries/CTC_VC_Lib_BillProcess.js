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
 * Script Name: CTC VC | Bill Process Library
 *
 * @author brianf@nscatalyst.com
 * @description Core Bill Creator engine that reads bill files, matches them to POs, evaluates variance, and prepares billing data for vendor bill generation.
 *
 * CHANGELOGS
 * Date         Author                Remarks
 * 2026-03-30   brianf                Restored vendor filter requirement in searchExistingBills: both entityId and invoiceNo must be present to prevent false-positive bill matches across vendors
 * 2026-03-14   brianf                Simplified reportError by consolidating duplicate error collection, cleaning variance message composition, and streamlining status report text assembly; normalized ctc_lib_utils/ctc_lib_error imports to explicit .js paths
 * 2026-03-13   brianf                Refactored bill process error handling to use ctc_lib_error with centralized ERROR_LIST;
 *                                      standardized state/config initialization and import usage; fixed billfile JSON/charges null-safety and fnCheck/report guard logic;
 *                                      cleaned redundant mappings/guards and aligned dumpCurrentData logTitle usage
 * 2026-03-09   brianf                Removed function-level JSDoc blocks from the bill process library
 * 2026-03-02   brianf                Added inline comments and JSDoc; replaced hardcoded record type strings with ns_record.Type constants;
 *                                       enforced full STATUS structure in resetValues and loadBillFile; fixed undeclared itemsAllMatched in preprocessBill
 * 2026-02-27   brianf                Converted CHANGELOGS to standard format
 * 2026-01-27   brianf                Improved item matching logic; removed legacy commented code
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var ns_record = require('N/record'),
        ns_search = require('N/search'),
        ns_config = require('N/config'),
        ns_util = require('N/util');

    var vc2_constant = require('./../../CTC_VC2_Constants');

    var vcs_configLib = require('./../../Services/ctc_svclib_configlib'),
        vcs_recordLib = require('./../../Services/ctc_svclib_records'),
        vcs_itemmatchLib = require('./../../Services/ctc_svclib_itemmatch');

    var vclib_util = require('./../../Services/lib/ctc_lib_utils.js'),
        vclib_error = require('./../../Services/lib/ctc_lib_error.js');

    var LogTitle = 'VC_BillProcess';

    var ERROR_LIST = {
        MISSING_PARAMETER: {
            code: 'MISSING_PARAMETER',
            message: 'Required parameter is missing: {details}',
            level: vclib_error.ErrorLevel.ERROR
        },
        MISSING_PO: {
            code: 'MISSING_PO',
            message: 'No linked Purchase Order specified in bill file or parameters.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        FULLY_BILLED: {
            code: 'FULLY_BILLED',
            message: 'The linked Purchase Order is already fully billed.',
            level: vclib_error.ErrorLevel.ERROR
        },
        CLOSED_PO: {
            code: 'CLOSED_PO',
            message: 'The linked Purchase Order is closed.',
            level: vclib_error.ErrorLevel.ERROR
        },
        PO_NOT_BILLABLE: {
            code: 'PO_NOT_BILLABLE',
            message: 'The linked Purchase Order is not in a billable status.',
            level: vclib_error.ErrorLevel.ERROR
        },
        MISSING_BILL_LINES: {
            code: 'MISSING_BILL_LINES',
            message: 'No bill lines with valid quantity found in the bill file.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        MISSING_BILLFILE_DATA: {
            code: 'MISSING_BILLFILE_DATA',
            message: 'Bill file record is missing required data fields.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        MISSING_BILLFILE_JSON: {
            code: 'MISSING_BILLFILE_JSON',
            message: 'Bill file data is missing or has invalid JSON payload.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        MISSING_INVOICE_NO: {
            code: 'MISSING_INVOICE_NO',
            message: 'Invoice number is missing from the bill file JSON payload.',
            level: vclib_error.ErrorLevel.ERROR
        },
        MISSING_BILLFILE_LINES: {
            code: 'MISSING_BILLFILE_LINES',
            message: 'No valid bill lines found in the bill file JSON payload.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        MISSING_VARIANCE_ITEM: {
            code: 'MISSING_VARIANCE_ITEM',
            message: 'Variance line is enabled but has no item configured.',
            level: vclib_error.ErrorLevel.ERROR
        },
        LINE_NO_INVENTORY_REQUIRED: {
            code: 'LINE_NO_INVENTORY_REQUIRED',
            message: 'Inventory detail is not required for this line item.',
            level: vclib_error.ErrorLevel.WARNING
        },
        INVALID_BILLFILE: {
            code: 'INVALID_BILLFILE',
            message: 'The bill file data is invalid or incomplete.',
            level: vclib_error.ErrorLevel.ERROR
        },
        VENDOR_BILL_CREATION_DISABLED: {
            code: 'VENDOR_BILL_CREATION_DISABLED',
            message: 'Vendor Bill creation is disabled via Main Config.',
            level: vclib_error.ErrorLevel.CRITICAL
        },
        BILL_REC_NOT_FOUND: {
            code: 'BILL_REC_NOT_FOUND',
            message: 'Failed to create or load the Vendor Bill record.',
            level: vclib_error.ErrorLevel.CRITICAL
        },

        VARIANCE_DETECTED_PRICE: {
            code: 'VARIANCE_DETECTED_PRICE',
            message: 'Price variance detected.',
            level: vclib_error.ErrorLevel.WARNING
        },
        VARIANCE_DETECTED_TAX: {
            code: 'VARIANCE_DETECTED_TAX',
            message: 'Variance in tax charge',
            level: vclib_error.ErrorLevel.WARNING
        },
        VARIANCE_DETECTED_SHIPPING: {
            code: 'VARIANCE_DETECTED_SHIPPING',
            message: 'Variance in shipping charge',
            level: vclib_error.ErrorLevel.WARNING
        },
        VARIANCE_DETECTED_CHARGES: {
            code: 'VARIANCE_DETECTED_CHARGES',
            message: 'Variance in other charges.',
            level: vclib_error.ErrorLevel.WARNING
        },

        ITEM_FULLY_BILLED: {
            code: 'ITEM_FULLY_BILLED',
            message: 'Item(s) has already been fully billed.',
            level: vclib_error.ErrorLevel.WARNING
        },
        INSUFFICIENT_RECEIVABLES: {
            code: 'INSUFFICIENT_RECEIVABLES',
            message: 'Not enough received quantity to bill.',
            level: vclib_error.ErrorLevel.WARNING
        },
        INSUFFICIENT_BILLABLE: {
            code: 'INSUFFICIENT_BILLABLE',
            message: 'Not enough billable quantity to bill.',
            level: vclib_error.ErrorLevel.WARNING
        },
        ITEM_NOT_BILLABLE: {
            code: 'ITEM_NOT_BILLABLE',
            message: 'Item(s) not billable.',
            level: vclib_error.ErrorLevel.WARNING
        },

        SHIPPING_NOT_ENABLED: {
            code: 'SHIPPING_NOT_ENABLED',
            message: 'Shipping charge is present but not enabled.',
            level: vclib_error.ErrorLevel.WARNING
        },

        SHIPPING_AMOUNT_ZERO: {
            code: 'SHIPPING_AMOUNT_ZERO',
            message: 'Shipping charge is enabled but the amount is zero.',
            level: vclib_error.ErrorLevel.WARNING
        },

        VBLINE_NOT_INCLUDED: {
            code: 'VBLINE_NOT_INCLUDED',
            message:
                'This line will not be included on the Vendor Bill due to errors or variances.',
            level: vclib_error.ErrorLevel.WARNING
        },

        EXCEED_THRESHOLD: {
            code: 'EXCEED_THRESHOLD',
            message: 'Variance exceeds the allowed threshold.',
            level: vclib_error.ErrorLevel.WARNING
        },
        WITHIN_THRESHOLD: {
            code: 'WITHIN_THRESHOLD',
            message: 'Variance is within the allowed threshold.',
            level: vclib_error.ErrorLevel.WARNING
        }
    };

    var Current = {
            BILL: {},
            BILLFILE: {},
            PO: {},
            CFG: {},
            STATUS: {
                PO: {},
                BILLFILE: {}
            },
            CHARGES: {}, // charge amounts pulled from BILLFILE.JSON.charges (shipping, other, tax)
            CHARGELINES: [], // variance line definitions to be added to the Vendor Bill
            TOTAL: {},
            Errors: {}, // map of errorCode → [details, ...]
            ErrorList: [], // ordered list of distinct error codes
            Variances: {}, // map of varianceCode → [details, ...]
            VarianceList: [] // ordered list of distinct variance codes
        },
        VarianceType = {
            PRICE: 'Price',
            TAX: 'Tax',
            SHIP: 'Shipping',
            OTHER: 'Other Charges',
            BILLTOTAL: 'Bill Total'
        },
        ChargeType = {
            TAX: 'tax',
            SHIP: 'shipping',
            OTHER: 'other',
            MISC: 'miscCharges',
            ADJ: 'adjustment'
        };

    var BillProcessLib = {
        Flex: Current,
        resetValues: function () {
            // Reset all top-level state objects so stale data from a prior run does not bleed through
            ns_util.extend(Current, {
                BILL: {},
                BILLFILE: {},
                PO: {},
                CFG: {},
                STATUS: {
                    ALLOWED_TO_BILL: [],
                    REJECT_TO_BILL: [],
                    BILLFILE: {
                        IsProcessed: false,
                        IsClosed: false,
                        IsActiveEdit: false,
                        ItemsAllBilled: false,
                        ItemsAllMatched: false,
                        AllowVariance: false,
                        IgnoreVariance: false,
                        AllowToReceive: false
                    },
                    PO: {
                        IsFullyBilled: false,
                        IsReceivable: false,
                        IsBillable: false,
                        IsClosed: false,
                        HasUnfulfillable: false
                    },
                    HasVariance: false,
                    HasErrors: false,
                    ReadyToBill: false,
                    AllowToBill: false
                },
                CHARGES: {},
                CHARGELINES: [],
                TOTAL: {},
                Errors: {},
                ErrorList: [],
                Variances: {},
                VarianceList: []
            });
            return true;
        },
        preprocessBill: function (option) {
            var logTitle = [LogTitle, 'PreProcessBill'].join('::'),
                returnValue = Current;

            option = option || {};
            try {
                //// INITIALIZE THE CONTEXT ////

                // load the Main Config
                Current.CFG.MainCFG = vcs_configLib.mainConfig();

                // Check NS accounting preference: UNRECEIVEDBILLS enables bill-in-advance
                // (lets us bill a PO before goods are received)
                var cfgACCTNG = ns_config.load({ type: ns_config.Type.ACCOUNTING_PREFERENCES });
                var allowBillInAdvance = cfgACCTNG.getValue({ fieldId: 'UNRECEIVEDBILLS' });

                Current.CFG.Features = {
                    BILL_IN_ADV: allowBillInAdvance
                };

                if (Current.CFG.MainCFG.isBillCreationDisabled) {
                    Helper.setError({ code: 'VENDOR_BILL_CREATION_DISABLED' }).log(logTitle);
                }

                // Load variance charge config (tax/shipping/other items and thresholds) first
                // so subsequent steps can reference ChargesDEF.
                this.loadVarianceConfig(option);

                // Load and parse the bill file record + vendor JSON payload
                this.loadBillFile(option);

                // Load and evaluate the linked PO; also pre-creates or loads the Vendor Bill record
                this.loadPOData(option);

                //// LOAD the Configs ////
                // Bill vendor config: prefer caller-supplied; fall back to PO-linked config;
                // final fallback uses the bill file's INTEGRATION field (config record id)
                Current.CFG.BillCFG =
                    option.billConfig ||
                    (Current.PO.ID
                        ? vcs_configLib.billVendorConfig({ poId: Current.PO.ID })
                        : {}) ||
                    (Current.BILLFILE.DATA
                        ? vcs_configLib.billVendorConfig({
                              configId: Current.BILLFILE.DATA.INTEGRATION
                          })
                        : {});

                // Order vendor config: prefer caller-supplied; fall back to PO-derived config
                Current.CFG.OrderCFG =
                    option.orderConfig ||
                    (Current.PO.ID ? vcs_configLib.orderVendorConfig({ poId: Current.PO.ID }) : {});

                Current.STATUS.IsBillable =
                    Current.STATUS.PO.IsBillable ||
                    (Current.CFG.Features.BILL_IN_ADV && Current.STATUS.PO.IsReceivable);

                Current.STATUS.IsReceivable =
                    Current.STATUS.PO.IsReceivable &&
                    Current.STATUS.BILLFILE.AllowToReceive &&
                    Current.CFG.BillCFG.enableFulfillment;

                /// LOAD THE BILL ///
                if (
                    !option.noBill &&
                    Current.STATUS.BILLFILE.IsActiveEdit &&
                    // Is Billable
                    Current.STATUS.IsBillable
                ) {
                    BillProcessLib.createBill({ recPO: Current.PO.REC });
                    BillProcessLib.loadBill({ recBill: Current.BILL.REC });
                }

                if (vclib_util.isEmpty(Current.PO.REC)) throw 'MISSING_PO';

                if (!Current.BILLFILE.DATA) throw 'MISSING_BILLFILE_DATA';
                if (!Current.BILLFILE.JSON) throw 'MISSING_BILLFILE_JSON';
                if (!Current.BILLFILE.JSON.invoice) throw 'MISSING_INVOICE_NO';
                if (!Current.BILLFILE.LINES || !Current.BILLFILE.LINES.length)
                    throw 'MISSING_BILLFILE_LINES';

                this.processBillFileLines(option);
                this.processBillLines(option);

                this.processCharges(option);
                this.processChargeLines(option);

                ///calcuate the variances
                this.calculateVariance(option);

                vclib_util.log(logTitle, '// Totals: ', Current.TOTAL);

                // Store pre-variance bill line totals; used in the diffTotal check after processChargeLines
                // to decide whether any residual unaccounted variance remains
                Current.TOTAL.PREVAR_BILL_LINES = Helper.roundOff(Current.TOTAL.BILL_LINES);
                Current.TOTAL.PREVAR_BILL_TOTAL = Helper.roundOff(Current.TOTAL.BILL_TOTAL);

                ////////////////////////////////
                // EVALUATE THE STATUS
                ns_util.extend(Current.STATUS, {
                    AllowToBill: false, /// set to false initially
                    AllowToReceive:
                        Current.CFG.BillCFG.enableFulfillment &&
                        Current.STATUS.BILLFILE.AllowToReceive
                });

                if (vclib_util.isEmpty(Current.STATUS.ALLOWED_TO_BILL))
                    Current.STATUS.ALLOWED_TO_BILL = [];
                if (vclib_util.isEmpty(Current.STATUS.REJECT_TO_BILL))
                    Current.STATUS.REJECT_TO_BILL = [];

                Current.STATUS.HasVariance = !vclib_util.isEmpty(Current.VarianceList);
                Current.STATUS.HasErrors = !vclib_util.isEmpty(Current.ErrorList);

                // Only evaluate allow/reject-to-bill logic when the bill file is in an editable state
                if (
                    Current.STATUS.BILLFILE.IsActiveEdit &&
                    // PO is BILLABLE, or..
                    (Current.STATUS.PO.IsBillable ||
                        // Bill in Advanced, and PO is Receivable //
                        (Current.CFG.Features.BILL_IN_ADV && Current.STATUS.PO.IsReceivable) ||
                        // PO is Receivable, and BillFile and Config Is Allowed to Receive
                        (Current.STATUS.PO.IsReceivable && Current.STATUS.AllowToReceive))
                ) {
                    if (
                        vclib_util.isEmpty(Current.VarianceList) &&
                        vclib_util.isEmpty(Current.ErrorList)
                    ) {
                        if (Current.STATUS.IsBillable) {
                            // Set Allow to Bill
                            Current.STATUS.AllowToBill = true;
                            Current.STATUS.ALLOWED_TO_BILL.push('NO_ERROR', 'NO_VARIANCE');
                        } else if (Current.STATUS.IsReceivable) {
                            Current.STATUS.AllowToBill = true;
                            Current.STATUS.ALLOWED_TO_BILL.push('NO_ERROR', 'NO_VARIANCE');
                        }
                    } else {
                        // Set Allow to Bill to false
                        Current.STATUS.AllowToBill = false;

                        if (Current.STATUS.HasVariance) {
                            /// Determine ways to create the bill if variances is detected

                            var isAllowedBill,
                                rejectBillReason = [],
                                allowedBillReason = [];

                            [
                                // TEST: Check if its allow variance or ignore variance
                                function () {
                                    var allowReason = Current.STATUS.BILLFILE.AllowVariance
                                        ? 'Variance allowed'
                                        : Current.STATUS.BILLFILE.IgnoreVariance
                                          ? 'Variance ignored'
                                          : false;

                                    return allowReason
                                        ? {
                                              allowed: true,
                                              reason: allowReason
                                          }
                                        : {
                                              allowed: false
                                          };
                                },

                                // TEST: Auto-process variance if the config is enabled for that variance type (e.g. autoprocPriceVar for price variances)
                                function () {
                                    var hasAutoProcessOn = [],
                                        hasNoAutoProcess = false,
                                        autoProcessConfig = {
                                            PRICE: !!Current.CFG.MainCFG.autoprocPriceVar,
                                            TAX: !!Current.CFG.MainCFG.autoprocTaxVar,
                                            SHIP: !!Current.CFG.MainCFG.autoprocShipVar,
                                            OTHER: !!Current.CFG.MainCFG.autoprocOtherVar
                                        };

                                    Current.VarianceList.forEach(function (varianceType) {
                                        if (autoProcessConfig[varianceType]) {
                                            hasAutoProcessOn.push(varianceType);
                                            Current.Variances[varianceType].push('AUTO');
                                        } else {
                                            hasNoAutoProcess = true;
                                            return false; // exit loop if any variance does not have auto-process enabled
                                        }
                                    });

                                    return !hasNoAutoProcess
                                        ? {
                                              allowed: true,
                                              reason:
                                                  'Auto-process variance: ' +
                                                  hasAutoProcessOn.join(', ')
                                          }
                                        : {
                                              allowed: false
                                          };
                                },

                                // TEST: Threshold test
                                function () {
                                    var returnValue = {};
                                    var thresholdAmount =
                                        Current.CFG.MainCFG.allowedVarianceAmountThreshold;

                                    if (vclib_util.isEmpty(thresholdAmount)) {
                                        returnValue.allowed = false;
                                    } else {
                                        thresholdAmount = vclib_util.forceFloat(thresholdAmount);
                                        if (
                                            thresholdAmount > 0 &&
                                            thresholdAmount >= Current.TOTAL.VARIANCE
                                        ) {
                                            returnValue.allowed = true;
                                            returnValue.reason = vclib_error.interpret(
                                                {
                                                    code: 'WITHIN_THRESHOLD',
                                                    detail: '(' + thresholdAmount + ')'
                                                },
                                                ERROR_LIST
                                            ).message;
                                        } else {
                                            returnValue.allowed = false;
                                            returnValue.reason = vclib_error.interpret(
                                                {
                                                    code: 'EXCEED_THRESHOLD',
                                                    detail: '(' + thresholdAmount + ')'
                                                },
                                                ERROR_LIST
                                            ).message;
                                        }
                                    }

                                    return returnValue;
                                }
                            ].forEach(function (fnCheck) {
                                if (!fnCheck || typeof fnCheck !== 'function') return;
                                if (isAllowedBill) return; // skip if its already allowed

                                var billCheck = fnCheck.call();

                                if (billCheck.allowed) {
                                    isAllowedBill = true;
                                    allowedBillReason.push(billCheck.reason);
                                    return false; // exit
                                } else if (billCheck.reason) {
                                    rejectBillReason.push(billCheck.reason);
                                }

                                return true;
                            });

                            if (isAllowedBill) {
                                Current.STATUS.AllowToBill = true;
                                Current.STATUS.ALLOWED_TO_BILL =
                                    Current.STATUS.ALLOWED_TO_BILL.concat(allowedBillReason);
                            } else {
                                Current.STATUS.AllowToBill = false;
                                Current.STATUS.REJECT_TO_BILL =
                                    Current.STATUS.REJECT_TO_BILL.concat(rejectBillReason);

                                // Report the error
                            }
                        }
                    }
                }
                ////////////////////////////
                this.reportError();
                ///////////////////////

                // // calculate the correct amount
            } catch (error) {
                // collect all the errors
                Helper.setError(error).log(logTitle);
            }

            return returnValue;
        },
        loadBillFile: function (option) {
            var logTitle = [LogTitle, 'loadBillFile'].join('::'),
                returnValue = Current.BILLFILE;

            try {
                ns_util.extend(Current.BILLFILE, {
                    ID: option.billFileId || option.internalId || option.id || null,
                    REC: option.recBillFile || option.billfileRec || null,
                    DATA: option.billFileData || null,
                    JSON: null,
                    LINES: []
                });

                if (!Current.BILLFILE.DATA) {
                    // If record not supplied, load it by ID
                    if (!Current.BILLFILE.REC) {
                        if (!Current.BILLFILE.ID)
                            throw { code: 'MISSING_PARAMETER', details: 'Bill File ID or Record' };

                        Current.BILLFILE.REC = vcs_recordLib.load({
                            type: vc2_constant.RECORD.BILLFILE.ID,
                            id: Current.BILLFILE.ID,
                            isDynamic: false
                        });

                        if (!Current.BILLFILE.REC) throw 'Unable to load the bill file record';
                    }

                    Current.BILLFILE.DATA = vcs_recordLib.extractValues({
                        record: Current.BILLFILE.REC,
                        fields: vc2_constant.RECORD.BILLFILE.FIELD
                    });
                }

                // PO_LINK is the foreign key to the Purchase Order; without it, billing cannot proceed
                if (vclib_util.isEmpty(Current.BILLFILE.DATA.PO_LINK))
                    Helper.setError({ code: 'MISSING_PO' }).log(logTitle);

                // Safely parse the stored JSON string; may be null if retrieval failed
                Current.BILLFILE.JSON = vclib_util.safeParse(Current.BILLFILE.DATA.JSON);
                if (vclib_util.isEmpty(Current.BILLFILE.DATA.JSON))
                    Helper.setError({ code: 'INVALID_BILLFILE' }).log(logTitle);

                if (
                    vclib_util.isEmpty(Current.BILLFILE.JSON) ||
                    !ns_util.isArray(Current.BILLFILE.JSON.lines)
                )
                    throw 'MISSING_BILLFILE_JSON';

                var BILLFILE_LINES = [],
                    totalAmount = 0;

                // Normalise each vendor line: cast numeric fields, build NS-compatible aliases,
                // and skip lines with no item or no price (informational rows).
                // prep the vendor lines
                Current.BILLFILE.JSON.lines.forEach(function (billfileLine, idx) {
                    try {
                        ['BILLRATE', 'RATE', 'PRICE'].forEach(function (field) {
                            if (billfileLine.hasOwnProperty(field))
                                billfileLine[field] = vclib_util.forceFloat(billfileLine[field]);
                            return true;
                        });
                        billfileLine.QUANTITY = vclib_util.forceInt(billfileLine.QUANTITY);
                        billfileLine.LINEIDX = idx;

                        ns_util.extend(billfileLine, {
                            quantity: billfileLine.QUANTITY,
                            itemId: (billfileLine.NSITEM || '').toString(),
                            rate: billfileLine.BILLRATE || billfileLine.PRICE,

                            item: (billfileLine.NSITEM || '').toString(),
                            itemName: billfileLine.ITEMNO,
                            description: billfileLine.DESCRIPTION
                        });
                        billfileLine.amount = billfileLine.quantity * billfileLine.rate;

                        totalAmount += billfileLine.amount;

                        // skip the line, if there are no ITEMNO, and there is no price
                        if (!billfileLine.ITEMNO && !billfileLine.PRICE) return;
                        if (!billfileLine.quantity) return;

                        // throw 'MISSING_ITEMNO';
                        // skip if no quantities
                    } catch (line_error) {
                        Helper.setError(line_error, billfileLine).log(logTitle);
                    } finally {
                        if (billfileLine.quantity) BILLFILE_LINES.push(billfileLine);
                    }

                    return true;
                });
                vclib_util.log(logTitle, '.. total bill lines: ', BILLFILE_LINES.length);
                if (vclib_util.isEmpty(BILLFILE_LINES)) throw 'MISSING_BILL_LINES';

                Current.BILLFILE.LINES = BILLFILE_LINES || [];

                // Sum charges from the vendor payload (shipping + other + tax)
                // These are used to compute BILLFILE_LINES = BILLFILE_TOTAL - totalCharges
                var billfileCharges =
                    (Current.BILLFILE.JSON && Current.BILLFILE.JSON.charges) || {};
                var totalCharges = 0;
                ['shipping', 'other', 'tax'].forEach(function (chargeType) {
                    Current.CHARGES[chargeType] = vclib_util.parseFloat(
                        billfileCharges[chargeType]
                    );
                    totalCharges += Current.CHARGES[chargeType];

                    return true;
                });

                Current.TOTAL.BILLFILE_LINES = totalAmount;
                Current.TOTAL.BILLFILE_CHARGES = totalCharges;
                Current.TOTAL.BILLFILE_TOTAL =
                    (Current.BILLFILE.JSON && Current.BILLFILE.JSON.total) || 0;
            } catch (error) {
                Helper.setError(error).log(logTitle);
            } finally {
                /////////// EVAL /////////////
                // Derive bill file status flags from the current DATA and JSON.
                // These flags are used throughout preprocessBill to decide branching.
                var VC_STATUS = vc2_constant.Bill_Creator.Status;

                if (!Current.STATUS.BILLFILE) Current.STATUS.BILLFILE = {};
                ns_util.extend(Current.STATUS.BILLFILE, {
                    // CLOSED means bill file was manually closed; no further action
                    IsClosed:
                        Current.BILLFILE.DATA && Current.BILLFILE.DATA.STATUS == VC_STATUS.CLOSED,

                    // PROCESSED means a Vendor Bill was already created from this file
                    IsProcessed:
                        Current.BILLFILE.DATA &&
                        Current.BILLFILE.DATA.STATUS == VC_STATUS.PROCESSED,

                    HasBilled: Current.BILLFILE.DATA && Current.BILLFILE.DATA.BILL_LINK,

                    // ItemsAllBilled: will be set true when all vendor lines are fully billed
                    ItemsAllBilled: false,

                    // ItemsAllMatched: will be updated in preprocessBill after line matching
                    ItemsAllMatched: false,

                    // AllowVariance: user has manually flagged this bill file to allow variance
                    AllowVariance: Current.BILLFILE.DATA && !!Current.BILLFILE.DATA.PROC_VARIANCE,

                    // IgnoreVariance: vendor JSON explicitly says to skip variance verification
                    IgnoreVariance: Current.BILLFILE.JSON && Current.BILLFILE.JSON.ignoreVariance,

                    AllowToReceive: Current.BILLFILE.DATA && !!Current.BILLFILE.DATA.IS_RCVBLE,

                    // IsActiveEdit: bill file is in an actionable status that allows processing
                    IsActiveEdit:
                        Current.BILLFILE.DATA &&
                        vclib_util.inArray(Current.BILLFILE.DATA.STATUS, [
                            VC_STATUS.PENDING,
                            VC_STATUS.ERROR,
                            VC_STATUS.REPROCESS,
                            VC_STATUS.VARIANCE
                        ])
                });

                /////////// EVAL /////////////
            }

            return returnValue;
        },
        loadPOData: function (option) {
            var logTitle = [LogTitle, 'loadPOData'].join('::'),
                returnValue = Current.PO.DATA;

            try {
                ns_util.extend(Current.PO, {
                    ID: option.poId || null,
                    REC: option.recPO || option.recordPO || null,
                    DATA: option.poData || option.orderData || {},
                    LINES: []
                });

                if (vclib_util.isEmpty(Current.PO.DATA)) {
                    if (!Current.PO.REC) {
                        // PO ID not supplied — fall back to the linked PO from the bill file
                        // get the PO Id from the BILL FILE Data
                        Current.PO.ID =
                            Current.PO.ID ||
                            (Current.BILLFILE.DATA && Current.BILLFILE.DATA.PO_LINK
                                ? Current.BILLFILE.DATA.PO_LINK
                                : null);

                        if (!Current.PO.ID) throw 'MISSING_PO';
                        Current.PO.REC = vcs_recordLib.load({
                            type: ns_record.Type.PURCHASE_ORDER,
                            id: Current.PO.ID,
                            isDynamic: false
                        });
                        if (!Current.PO.REC) throw 'Unable to load the purchase order';
                    }

                    Current.PO.ID = Current.PO.ID || Current.PO.REC.id;
                    Current.PO.DATA = vcs_recordLib.extractValues({
                        record: Current.PO.REC,
                        fields: [
                            'internalid',
                            'tranid',
                            'createdfrom',
                            'entity',
                            'total',
                            'taxtotal',
                            'tax2total',
                            'status',
                            'statusRef'
                        ]
                    });
                }

                // Look up the linked Sales Order for customer context used when adding variance lines
                Current.SO_DATA = Helper.getSalesOrderDetails({ id: Current.PO.ID });
                if (vclib_util.isEmpty(Current.PO.REC))
                    throw 'Unable to load the purchase order record';

                /// EVAL THE PO STATUS ///
                if (!Current.STATUS.PO) Current.STATUS.PO = {};
                ns_util.extend(Current.STATUS.PO, {
                    IsFullyBilled: vclib_util.inArray(Current.PO.DATA.statusRef, ['fullyBilled']),
                    IsClosed: vclib_util.inArray(Current.PO.DATA.statusRef, ['closed']),
                    IsReceivable: vclib_util.inArray(Current.PO.DATA.statusRef, [
                        'pendingReceipt',
                        'partiallyReceived',
                        'pendingBillPartReceived'
                    ]),
                    IsBillable:
                        vclib_util.inArray(Current.PO.DATA.statusRef, [
                            'pendingBilling',
                            'pendingBillPartReceived'
                        ]) || Current.CFG.Features.BILL_IN_ADV
                });

                /// Get the Order Lines ///
                // Fetch full order line sublist including qty columns for receivable/billable calculations
                Current.PO.LINES =
                    vcs_recordLib.extractLineValues({
                        record: Current.PO.REC,
                        findAll: true,
                        columns: [
                            'line',
                            'linenumber',
                            'item',
                            'rate',
                            'quantity',
                            'amount',
                            'quantityreceived',
                            'quantitybilled',
                            'fulfillable',
                            'taxcode',
                            'taxrate',
                            'taxrate1',
                            'taxrate2',
                            'poline',
                            'orderline',
                            'lineuniquekey'
                        ],
                        orderConfig: Current.CFG.OrderCFG,
                        mainConfig: Current.CFG.MainCFG
                    }) || [];

                var TotalShipping = 0,
                    ChargesDEF = Current.CFG.ChargesDEF || {};

                // Scan PO lines to collect the active tax code and total shipping amount;
                // also detect non-fulfillable lines that may make the PO directly billable.
                // Get the taxCode
                var poTaxCode = null,
                    hasUnfulfillable = false;

                Current.PO.LINES.forEach(function (orderLine) {
                    orderLine.itemId = orderLine.item; // alias used by item-matching library

                    poTaxCode = orderLine.taxcode; // last seen taxcode (all lines share it on a standard PO)
                    orderLine.APPLIEDTAX = Helper.calculateLineTax(orderLine);

                    if (Helper.isShippingLineHelper(orderLine, ChargesDEF)) {
                        orderLine.IS_SHIPPING = true;
                        TotalShipping += orderLine.amount; // accumulate shipping line value
                    }

                    // check if the line is fulfillable; if not, the PO may need to be billed directly without receiving
                    if (!orderLine.fulfillable) hasUnfulfillable = true;
                });

                /// PO is BILLABLE if there are non-fulfillable items
                if (hasUnfulfillable) {
                    Current.STATUS.PO.HasUnfulfillable = true;
                    // allowNonFFItems in MainCFG tells us to treat non-fulfillable items as directly billable
                    if (Current.CFG.MainCFG.allowNonFFItems) Current.STATUS.PO.IsBillable = true;
                }

                Current.PO.DATA.TaxCode = poTaxCode;
                Current.TOTAL.SHIPPING = TotalShipping;
            } catch (error) {
                Helper.setError(error).log(logTitle);
            } finally {
                /////////// EVAL /////////////
                // SET THE STATUS ///

                if (Current.STATUS.PO.IsClosed) {
                    // Set the appropriate error code based on whether PO is fully billed or just closed
                    Helper.setError({
                        code: Current.STATUS.PO.IsFullyBilled ? 'FULLY_BILLED' : 'CLOSED_PO'
                    }).log(logTitle);
                }
            }

            return returnValue;
        },
        loadVarianceConfig: function (option) {
            var logTitle = [LogTitle, 'loadVarianceConfig'].join('::'),
                returnValue = {};

            try {
                if (vclib_util.isEmpty(Current.CFG.MainCFG))
                    Current.CFG.MainCFG = vcs_configLib.mainConfig();

                // vclib_util.log(logTitle, '// CFG: ', Current.CFG);

                var ChargesDEF = {
                    tax: {
                        name: 'Tax',
                        description: 'VC | Tax Charges',
                        item: Current.CFG.MainCFG.defaultTaxItem,
                        applied: Current.CFG.MainCFG.isVarianceOnTax ? 'T' : 'F',
                        enabled: Current.CFG.MainCFG.isVarianceOnTax,
                        autoProc: Current.CFG.MainCFG.autoprocTaxVar
                    },
                    shipping: {
                        name: 'Shipping',
                        description: 'VC | Shipping Charges',
                        item: Current.CFG.MainCFG.defaultShipItem,
                        applied: Current.CFG.MainCFG.isVarianceOnShipping ? 'T' : 'F',
                        enabled: Current.CFG.MainCFG.isVarianceOnShipping,
                        autoProc: Current.CFG.MainCFG.autoprocShipVar
                    },
                    other: {
                        name: 'Other Charges',
                        description: 'VC | Other Charges',
                        item: Current.CFG.MainCFG.defaultOtherItem,
                        applied: Current.CFG.MainCFG.isVarianceOnOther ? 'T' : 'F',
                        enabled: Current.CFG.MainCFG.isVarianceOnOther,
                        autoProc: Current.CFG.MainCFG.autoprocOtherVar
                    },
                    miscCharges: {
                        name: 'Misc Charges',
                        description: 'VC | Misc Charges',
                        item: Current.CFG.MainCFG.defaultOtherItem,
                        applied: Current.CFG.MainCFG.isVarianceOnOther ? 'T' : 'F',
                        enabled: Current.CFG.MainCFG.isVarianceOnOther,
                        autoProc: Current.CFG.MainCFG.autoprocOtherVar
                    }
                };

                vclib_util.log(logTitle, '## ChargesDEF', ChargesDEF);

                // Validate: if a charge type is enabled but its NS item is not configured, flag an error
                for (var chargeType in ChargesDEF) {
                    var chargeInfo = ChargesDEF[chargeType];

                    // check if enabled, but not set!
                    if (chargeInfo.enabled && !chargeInfo.item)
                        Helper.setError({
                            code: 'MISSING_VARIANCE_ITEM',
                            detail: chargeInfo.name
                        }).log(logTitle);
                }

                Current.CFG.ChargesDEF = ChargesDEF;
                returnValue = ChargesDEF;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }
            return returnValue;
        },
        loadBill: function (option) {
            var logTitle = [LogTitle, 'loadBill'].join('::'),
                returnValue = Current;
            option = option || {};

            try {
                Current.BILL.REC = option.recBill || option.recordBill || Current.BILL.REC;
                Current.BILL.DATA = option.billData || Current.BILL.DATA;
                Current.BILL.ID = option.billId || Current.BILL.ID;

                if (!Current.BILL.REC) throw 'BILL_REC_NOT_FOUND';

                // Extract bill header: tranid, entity, total, tax fields, status
                Current.BILL.DATA = vcs_recordLib.extractValues({
                    record: Current.BILL.REC,
                    fields: [
                        'tranid',
                        'entity',
                        'total',
                        'taxtotal',
                        'tax2total',
                        'status',
                        'statusRef'
                    ]
                });

                // Combine taxtotal + tax2total for jurisdictions with split tax (e.g. CA)
                Current.BILL.DATA.APPLIEDTAX =
                    (Current.BILL.DATA.taxtotal || 0) + (Current.BILL.DATA.tax2total || 0);

                Current.BILL.DATA.APPLIEDTAX = Helper.roundOff(Current.BILL.DATA.APPLIEDTAX, 4);

                // Extract bill item lines with all qty/rate/tax columns used for variance calculation
                Current.BILL.LINES =
                    vcs_recordLib.extractLineValues({
                        record: Current.BILL.REC,
                        findAll: true,
                        columns: [
                            'applied',
                            'item',
                            'rate',
                            'quantity',
                            'amount',
                            'quantityreceived',
                            'quantitybilled',
                            'grossamt',
                            'taxrate',
                            'taxrate1',
                            'taxrate2',
                            'orderline',
                            'line'
                        ],
                        orderConfig: Current.CFG.OrderCFG,
                        mainConfig: Current.CFG.MainCFG
                    }) || [];
                var billLineTotal = 0,
                    billLineTaxTotal = 0;
                Current.BILL.LINES.forEach(function (billLine) {
                    billLine.itemId = billLine.item;
                    billLine.APPLIEDTAX = Helper.calculateLineTax(billLine);
                    billLine.APPLIEDTAX = Helper.roundOff(billLine.APPLIEDTAX, 4);

                    billLineTotal += billLine.amount;
                    billLineTaxTotal += billLine.APPLIEDTAX;
                });

                Current.TOTAL.BILL_APPLIEDTAX = Current.BILL.DATA.APPLIEDTAX;
                Current.TOTAL.BILL_LINETAX = billLineTaxTotal;
                Current.TOTAL.BILL_TOTAL = Current.BILL.DATA.total;
                Current.TOTAL.BILL_LINES = billLineTotal;
            } catch (error) {
                Helper.setError(error).log(logTitle);
            }

            return Current.BILL;
        },
        createBill: function (option) {
            var logTitle = [LogTitle, 'createBill'].join('::'),
                returnValue = Current;

            option = option || {};
            try {
                Current.PO.REC = option.recPO || option.recordPO || null;
                if (!Current.STATUS.PO.IsBillable) throw 'NOT_BILLABLE';

                var transformOption = {
                    fromType: ns_record.Type.PURCHASE_ORDER,
                    fromId: Current.PO.ID,
                    toType: ns_record.Type.VENDOR_BILL,
                    isDynamic: true
                };
                vclib_util.log(logTitle, '// transformOption: ', transformOption);

                if (Current.CFG.MainCFG && Current.CFG.MainCFG.defaultBillForm)
                    transformOption.customform = Current.CFG.MainCFG.defaultBillForm;

                var billTransformRec = vcs_recordLib.transform(transformOption);

                Current.BILL.REC = billTransformRec;

                if (Current.CFG.MainCFG && Current.CFG.MainCFG.defaultBillForm) {
                    Current.BILL.REC.setValue({
                        fieldId: 'customform',
                        value: Current.CFG.MainCFG.defaultBillForm
                    });
                }
            } catch (error) {
                Helper.setError(error).log(logTitle);
            }

            return returnValue;
        },
        processBillFileLines: function (option) {
            var logTitle = [LogTitle, 'processBillFileLines'].join('::'),
                returnValue = Current.BILLFILE.LINES;

            try {
                if (!Current.PO.LINES) this.loadPOData(option);

                // Prepare ITEM_TEXT and ITEM_SKU on each bill file line so the item matcher can
                // use them. If the line already has an NSITEM, resolve text from the PO lines.
                var matchedVendorLines = vcs_itemmatchLib.matchVendorLines({
                    poRec: Current.PO.REC,
                    poLines: Current.PO.LINES,
                    availableQtyType: Current.STATUS.BILLFILE.IsActiveEdit ? 'BILLABLE' : 'FULL',
                    vendorLines: (function () {
                        Current.BILLFILE.LINES.forEach(function (line) {
                            var itemText, itemSKU;

                            if (line.NSITEM) {
                                // lookup under PO Lines, means we got a match
                                var poLine = vclib_util.findMatching({
                                    dataSet: Current.PO.LINES,
                                    filter: { itemId: line.NSITEM }
                                });

                                if (poLine && poLine.item_text) {
                                    itemText = poLine.item_text;
                                }
                            } else {
                                itemText = line.itemName || line.ITEMNO;
                                itemSKU = line.itemSKU || line.SKU;
                            }

                            line.ITEM_TEXT = itemText; // used by isItemMatched for direct comparison
                            line.ITEM_SKU = itemSKU; // used as alternate SKU match key
                        });
                        return Current.BILLFILE.LINES;
                    })(),

                    vendorConfig: Current.CFG.OrderCFG,
                    mainConfig: Current.CFG.MainCFG
                });

                // initially set the items are all matched
                Current.STATUS.BILLFILE.ItemsAllMatched = true;
                Current.STATUS.BILLFILE.ItemsAllBilled = null;

                Current.BILLFILE.LINES.forEach(function (vendorLine, idx) {
                    /// extend the vendor line with the matched order line info, and init variance fields

                    ns_util.extend(ns_util.extend(vendorLine, matchedVendorLines[idx]), {
                        OrderLine: {},
                        VarianceAmt: 0,
                        ReadyToBill: false,

                        Errors: {},
                        Variances: {},
                        ErrorList: [],
                        VarianceList: []
                    });

                    try {
                        // there are no matched items for this
                        if (!vendorLine.MATCHING || vclib_util.isEmpty(vendorLine.MATCHING)) {
                            Current.STATUS.BILLFILE.ItemsAllMatched = false;
                            throw 'UNMATCHED_ITEMS';
                        }

                        // Loop thru each matching order line,
                        // try to detect if the bill qty will have enough room
                        // Merge quantities when multiple PO lines match the same vendor item (split PO lines)
                        var matchedOrderLine = {};
                        vendorLine.MATCHING.forEach(function (matchedLine) {
                            if (vclib_util.isEmpty(matchedOrderLine)) {
                                ns_util.extend(matchedOrderLine, matchedLine);
                            } else {
                                matchedOrderLine.quantity =
                                    (matchedOrderLine.quantity || 0) + matchedLine.quantity;

                                matchedOrderLine.quantityreceived =
                                    (matchedOrderLine.quantityreceived || 0) +
                                    matchedLine.quantityreceived;

                                matchedOrderLine.quantitybilled =
                                    (matchedOrderLine.quantitybilled || 0) +
                                    matchedLine.quantitybilled;
                            }

                            var qtyRcvd = vclib_util.forceInt(matchedLine.quantityreceived),
                                qtyBilled = vclib_util.forceInt(matchedLine.quantitybilled);

                            matchedOrderLine.QTYRCVD = (matchedOrderLine.QTYRCVD || 0) + qtyRcvd;
                            matchedOrderLine.QTYBILLED =
                                (matchedOrderLine.QTYBILLED || 0) + qtyBilled;

                            // Factor in Bill-In-Advance: treat full ordered qty as "receivable" for billing
                            if (Current.CFG.Features.BILL_IN_ADV) {
                                matchedOrderLine.QTYRCVD = matchedOrderLine.quantity;
                            }
                        });

                        matchedOrderLine.APPLIEDTAX = Helper.calculateLineTax(
                            ns_util.extend(matchedOrderLine, {
                                amount: matchedOrderLine.QUANTITY * matchedOrderLine.APPLIEDRATE
                            })
                        );
                        vendorLine.APPLIEDTAX = matchedOrderLine.APPLIEDTAX; // alias used for direct comparison in variance check
                        vendorLine.OrderLine = matchedOrderLine;

                        // VARIANCE CHECK: flag PRICE variance when vendor rate differs from PO rate
                        if (vendorLine.rate != matchedOrderLine.rate) {
                            var diffRate = vendorLine.rate - matchedOrderLine.rate,
                                diffAmount = diffRate * vendorLine.QUANTITY;

                            diffRate = Helper.roundOff(diffRate);
                            diffAmount = Helper.roundOff(diffAmount);

                            // add the Price Variance
                            if (Math.abs(diffAmount)) {
                                // set thee
                                vendorLine.VarianceAmt += diffAmount;

                                Helper.setError(
                                    {
                                        code: 'VARIANCE_DETECTED_PRICE',
                                        details: diffAmount,
                                        varianceCode: 'PRICE'
                                    },
                                    vendorLine
                                ).log(logTitle);
                            }
                        }

                        // Determine canBillInAdvance: true if... if the and — effectively allows
                        var canBillInAdvance =
                            // BILL_IN_ADV feature is on OR ..
                            Current.CFG.Features.BILL_IN_ADV ||
                            // PO is receivable
                            (Current.STATUS.PO.IsReceivable &&
                                // fulfillment is enabled
                                Current.CFG.BillCFG.enableFulfillment &&
                                // bill file is flagged receivable
                                Current.BILLFILE.DATA &&
                                Current.BILLFILE.DATA.IS_RCVBLE);

                        if (Current.CFG.MainCFG.allowNonFFItems && !matchedOrderLine.fulfillable) {
                            // Non-fulfillable lines are billed directly without receiving
                            matchedOrderLine.RECEIVABLE = 0;
                            matchedOrderLine.BILLABLE =
                                matchedOrderLine.quantity - matchedOrderLine.QTYBILLED;
                        } else {
                            // We can only receive qty that is not received/fulfilled yet
                            matchedOrderLine.RECEIVABLE =
                                matchedOrderLine.quantity - matchedOrderLine.QTYRCVD;

                            // We can only bill qty we received and is unbilled,
                            // unless bill-in-advance or bill file is receivable
                            matchedOrderLine.BILLABLE = canBillInAdvance
                                ? matchedOrderLine.quantity - matchedOrderLine.QTYBILLED
                                : matchedOrderLine.QTYRCVD - matchedOrderLine.QTYBILLED;
                        }
                        Current.TOTAL.POLINES += matchedOrderLine.amount;
                        Current.TOTAL.POLINE_TAX += matchedOrderLine.APPLIEDTAX;

                        // check if the item is a shipping line
                        if (
                            (vendorLine.ITEMNO && vendorLine.ITEMNO.match(/shipping|freight/gi)) ||
                            (vendorLine.OrderLine &&
                                vendorLine.OrderLine.item_text &&
                                vendorLine.OrderLine.item_text.match(/shipping|freight/gi))
                        ) {
                            vendorLine.SHIPPING_LINE = true;
                        }

                        if (vendorLine.SHIPPING_LINE) {
                            vclib_util.log(logTitle, '...skipping shipping line');
                            // } else if (
                            //     !vendorLine.OrderLine.fulfillable &&
                            //     Current.CFG.MainCFG.allowNonFFItems
                            // ) {
                            //     vclib_util.log(logTitle, '...skipping non-fulfillable line');
                        } else {
                            // no receivable, and no billable (#6)
                            if (
                                matchedOrderLine.RECEIVABLE <= 0 &&
                                matchedOrderLine.BILLABLE <= 0
                            ) {
                                if (Current.STATUS.BILLFILE.ItemsAllBilled === null)
                                    Current.STATUS.BILLFILE.ItemsAllBilled = true;

                                throw 'ITEM_FULLY_BILLED';
                            }

                            // definitely not all billed
                            Current.STATUS.BILLFILE.ItemsAllBilled = false;

                            // not enough billable qty
                            if (matchedOrderLine.BILLABLE < vendorLine.quantity) {
                                // check if we're allowed to receive it
                                var allowedtoReceive =
                                    Current.STATUS.PO.IsReceivable && // if the PO is actually receivable
                                    Current.CFG.BillCFG.enableFulfillment && // Fulfillment is allowed on the config
                                    Current.BILLFILE.DATA.IS_RCVBLE; // if the billfile is receiveable

                                if (allowedtoReceive) {
                                    // allwed to receive, but on enough receivableqty
                                    if (matchedOrderLine.RECEIVABLE < vendorLine.quantity)
                                        throw 'INSUFFICIENT_RECEIVABLES';
                                } else {
                                    // we can't receive, just check if its just insufficient bill or item is already billed
                                    throw matchedOrderLine.BILLABLE > 0
                                        ? 'INSUFFICIENT_BILLABLE'
                                        : 'ITEM_NOT_BILLABLE';
                                }
                            }
                        }
                    } catch (line_error) {
                        Helper.setError(line_error, vendorLine).warn(logTitle);
                    } finally {
                        // Line is ReadyToBill only when: no errors or variances, and BILLABLE qty covers vendor qty
                        if (
                            vclib_util.isEmpty(vendorLine.ErrorList) &&
                            vclib_util.isEmpty(vendorLine.VarianceList) &&
                            matchedOrderLine.BILLABLE &&
                            matchedOrderLine.BILLABLE >= vendorLine.quantity
                        )
                            vendorLine.ReadyToBill = true;

                        vclib_util.log(logTitle, '## Bill Line [' + (idx + 1) + '] ', vendorLine);
                    }
                });

                // round off
                Current.TOTAL.POLINES = Helper.roundOff(Current.TOTAL.POLINES);
                Current.TOTAL.POLINE_TAX = Helper.roundOff(Current.TOTAL.POLINE_TAX);
            } catch (error) {
                Helper.setError(error).log(logTitle);
            } finally {
                /////////// EVAL /////////////
                // STATUS.ReadyToBill is false if ANY vendor line is not ready
                Current.STATUS.ReadyToBill = false; // initial value
                if (vclib_util.isEmpty(Current.PO.REC)) return;

                Current.STATUS.ReadyToBill = Current.BILLFILE.LINES.every(function (vendorLine) {
                    return vendorLine.ReadyToBill;
                });
                /////////// EVAL /////////////
            }

            return returnValue;
        },
        processBillLines: function (option) {
            var logTitle = [LogTitle, 'processBillLines'].join('::'),
                returnValue = Current.BILL.DATA;
            option = option || {};

            try {
                ns_util.extend(Current.BILL, {
                    ID: option.billId || Current.BILL.ID,
                    REC: option.recBill || option.recordBill || Current.BILL.REC,
                    DATA: option.billData || Current.BILL.DATA
                });

                // if (!Current.STATUS.PO.IsBillable && ) throw 'PO_NOT_BILLABLE';
                // if (!Current.BILL.REC) throw 'BILL_REC_NOT_FOUND';
                if (!Current.BILLFILE.LINES) throw 'MISSING_BILLFILE_LINES';

                var ChargesDEF = Current.CFG.ChargesDEF || {};

                var arrLinesToBill = [],
                    arrUnmatchedLines = [];

                var billLines = (Current.BILL && Current.BILL.LINES) || [];

                Current.BILLFILE.LINES.forEach(function (billfileLine) {
                    vclib_util.log(logTitle, '// MATCHED BILL LINES: ', billfileLine);

                    if (vclib_util.isEmpty(billfileLine.MATCHING)) {
                        arrUnmatchedLines.push(billfileLine); // track unmatched lines for logging
                        return;
                    }

                    var qtyToApply = vclib_util.forceInt(billfileLine.QUANTITY);

                    // For each matched PO line, allocate as much qty as available up to qtyToApply
                    // preferred, filter vendor bill orderline against PO lines
                    billfileLine.MATCHING.forEach(function (matchedLine) {
                        var availBillQty = vclib_util.forceInt(matchedLine.AVAILBILLQTY),
                            itemqty = Math.min(availBillQty, qtyToApply);

                        // return false if there is no itemqty, or if it doesn't fit qtyToApply
                        if (!itemqty) return false;

                        qtyToApply -= itemqty;

                        arrLinesToBill.push(
                            vclib_util.extend(
                                vclib_util.extend(
                                    // combine matchedLine,
                                    matchedLine,
                                    // add the RATE, TRACKING and SERIAL
                                    vclib_util.extractValues({
                                        source: billfileLine,
                                        params: ['BILLRATE', 'PRICE', 'TRACKING', 'SERIAL']
                                    })
                                ),
                                {
                                    itemquantity: itemqty,
                                    quantity: itemqty
                                }
                            )
                        );
                    });
                });

                // Iterate Vendor Bill lines in reverse so we can safely remove lines while iterating
                Current.Serials = [];
                var appliedShippingAmount = 0;
                for (var line = billLines.length - 1; line >= 0; line--) {
                    var vbLineValue = vcs_recordLib.extractLineValues({
                            record: Current.BILL.REC,
                            sublistId: 'item',
                            line: line,
                            columns: [
                                'line',
                                'item',
                                'quantity',
                                'rate',
                                'binitem',
                                'inventorydetailreq',
                                'inventorydetailavail',
                                'inventorydetailset',
                                'inventorydetail',
                                'isserial'
                            ]
                        }),
                        appliedVBLine = vclib_util.findMatching({
                            dataSet: arrLinesToBill,
                            filter: { line: vbLineValue.line }
                        }),
                        isShippingLine = Helper.isShippingLineHelper(vbLineValue, ChargesDEF);

                    try {
                        // Shipping lines: only keep if shipping charges are enabled; set amount from bill file
                        if (isShippingLine) {
                            if (
                                !ChargesDEF.shipping ||
                                !ChargesDEF.shipping.enabled ||
                                !ChargesDEF.shipping.applied
                            )
                                throw 'SHIPPING_NOT_ENABLED';

                            var shippingAmount =
                                Current.BILLFILE.JSON &&
                                Current.BILLFILE.JSON.charges &&
                                Current.BILLFILE.JSON.charges.shipping
                                    ? Current.BILLFILE.JSON.charges.shipping
                                    : 0;

                            if (shippingAmount <= 0) throw 'SHIPPING_AMOUNT_ZERO';
                            appliedShippingAmount += appliedShippingAmount;

                            // add to status
                            Current.STATUS.BILLFILE.HasExistingShippingLine = true;
                        } else if (appliedVBLine) {
                            vcs_recordLib.updateLineValues({
                                record: Current.BILL.REC,
                                sublistId: 'item',
                                line: line,
                                values: {
                                    rate: Current.STATUS.BILLFILE.AllowVariance
                                        ? appliedVBLine.BILLRATE || appliedVBLine.PRICE
                                        : appliedVBLine.APPLIEDRATE || appliedVBLine.rate,
                                    quantity: appliedVBLine.QUANTITY
                                }
                            });

                            /// PROCESS THE SERIAL NUM //
                            Helper.processInventoryDetails({
                                record: Current.BILL.REC,
                                lineNo: line,
                                appliedQty: appliedVBLine.APPLIEDQTY,
                                serials: appliedVBLine.SERIAL
                            });

                            // add the serial data
                            if (!vclib_util.isEmpty(appliedVBLine.SERIAL)) {
                                Current.Serials.push({
                                    ITEM: vbLineValue.item,
                                    PURCHASE_ORDER: Current.PO.ID,
                                    CUSTOMER:
                                        Current.SO_DATA.entity.value || Current.SO_DATA.entity,
                                    SALES_ORDER: Current.PO.DATA.createdfrom,
                                    serials: appliedVBLine.SERIAL
                                });
                            }
                        } else {
                            // skip this bill
                            Current.BILL.REC.removeLine({ sublistId: 'item', line: line });
                            continue;
                        }
                    } catch (billline_error) {
                        Helper.setError(billline_error).log(logTitle);
                        Current.BILL.REC.removeLine({ sublistId: 'item', line: line });
                    }
                }

                // reset the shipping
                Current.TOTAL.SHIPPING = appliedShippingAmount;

                // // reload the bill data
                if (Current.BILL && Current.BILL.REC) this.loadBill();
            } catch (error) {
                Helper.setError(error).log(logTitle);
            }

            return returnValue;
        },
        processCharges: function (option) {
            var logTitle = [LogTitle, 'processCharges'].join('::'),
                returnValue = Current.CHARGELINES;

            try {
                var ChargesCFG = Current.CFG.ChargesDEF || {};

                var totalAppliedCharges = 0;

                // First loop, lets just determine the amounts for each charges and the variances
                for (var type in ChargesCFG) {
                    var chargeInfo = ChargesCFG[type],
                        chargeAmount = Current.CHARGES[type] || 0; // amount from vendor payload

                    // Build the charge line object by merging type/amount with ChargesDEF config
                    var chargeLine = vclib_util.extend(
                            { type: type, amount: chargeAmount },
                            chargeInfo
                        ),
                        // find existing variance line
                        varianceLine = vclib_util.findMatching({
                            dataSet: Current.BILLFILE.JSON.variance || [],
                            filter: { type: chargeInfo.name || type }
                        });

                    switch (type) {
                        case ChargeType.TAX:
                            var taxVariance = 0;

                            if (ChargesCFG[type].enabled && !Current.CFG.BillCFG.ignoreTaxVar) {
                                taxVariance = chargeAmount - Current.TOTAL.BILL_TAX;
                                chargeLine.applied = 'T';

                                if (taxVariance)
                                    Helper.setError({
                                        code: 'VARIANCE_DETECTED_TAX',
                                        details: taxVariance,
                                        varianceCode: 'TAX'
                                    }).log(logTitle);
                            } else {
                                chargeLine.applied = 'F';
                            }

                            chargeLine.calcAmount = Current.TOTAL.BILL_TAX;
                            chargeLine.varianceAmount = taxVariance;
                            totalAppliedCharges += taxVariance;

                            break;

                        case ChargeType.SHIP:
                            var shipVariance = 0;

                            if (ChargesCFG[type].enabled) {
                                shipVariance =
                                    chargeAmount > 0 ? chargeAmount - Current.TOTAL.SHIPPING : 0;
                                shipVariance = vclib_util.roundOff(shipVariance, 4);
                                chargeLine.applied = 'T';

                                if (shipVariance != 0)
                                    Helper.setError({
                                        code: 'VARIANCE_DETECTED_SHIPPING',
                                        details: shipVariance,
                                        varianceCode: 'SHIP'
                                    }).log(logTitle);
                            } else {
                                chargeLine.applied = 'F';
                            }

                            chargeLine.calcAmount = Current.TOTAL.SHIPPING;
                            chargeLine.varianceAmount = shipVariance;
                            totalAppliedCharges += shipVariance;

                            break;

                        case ChargeType.OTHER:
                        case ChargeType.MISC:
                            var otherVariance = 0;

                            if (ChargesCFG[type].enabled) {
                                otherVariance = chargeAmount - (Current.TOTAL.CHARGES || 0);
                                chargeLine.applied = 'T';
                                otherVariance = vclib_util.roundOff(otherVariance, 4);

                                if (otherVariance != 0)
                                    Helper.setError({
                                        code: 'VARIANCE_DETECTED_CHARGES',
                                        varianceCode: 'OTHER',
                                        details: otherVariance
                                    }).log(logTitle);
                            } else {
                                chargeLine.applied = 'F';
                            }

                            chargeLine.calcAmount = Current.TOTAL.CHARGES;
                            chargeLine.varianceAmount = otherVariance;
                            totalAppliedCharges += otherVariance;

                            break;
                    }

                    Current.CHARGELINES.push(chargeLine);
                }

                Current.TOTAL.APPLIED_CHARGES = totalAppliedCharges;

                /// loop thru the discounted
                var discountedLines = Current.BILLFILE.JSON.discounted;
                (discountedLines || []).forEach(function (discounted) {
                    if (discounted.applied) return;

                    var chargeInfo = ChargesCFG.shipping;

                    Current.CHARGELINES.push(
                        vclib_util.extend(chargeInfo, {
                            name: discounted.name + ' Discounted',
                            item: null,
                            description: '(Discounted) ' + discounted.name,
                            amount: discounted.amount,
                            applied: 'F',
                            enabled: false,
                            varianceAmount: 0
                        })
                    );
                });
            } catch (error) {
                Helper.setError(error).log(logTitle);
            }

            return returnValue;
        },
        addChargeLine: function (option) {
            var logTitle = [LogTitle, 'addChargeLine'].join('::'),
                returnValue = null;
            try {
                var chargeType = option.chargeType || option.type || ChargeType.OTHER,
                    chargeName = option.chargeName || option.name,
                    varianceAmount = option.varianceAmount,
                    chargeAmount = option.chargeAmount || option.amount || option.rate,
                    chargeDescription = option.description;

                if (!Current.CFG.ChargesDEF[chargeType]) return false;
                var chargeLine = ns_util.extend({}, Current.CFG.ChargesDEF[chargeType]);

                // Merge the override values onto the charge line definition
                ns_util.extend(chargeLine, {
                    name: chargeName || chargeLine.name,
                    varianceAmount: varianceAmount,
                    description: chargeDescription || chargeLine.description,
                    rate: chargeAmount,
                    amount: chargeAmount,
                    taxcode: Current.PO.DATA.taxcode
                });

                // add the variance line to CHARGELINES for processing by processChargeLines()
                Current.CHARGELINES.push(chargeLine);
            } catch (error) {
                // collect all the errors
                vclib_error.log(logTitle, error, ERROR_LIST);
            }
            return true;
        },
        searchExistingBills: function (option) {
            var logTitle = [LogTitle, 'searchExistingBills'].join('::'),
                // Fixed: initialized returnValue to null per standard function pattern
                returnValue = null;
            option = option || {};

            try {
                // Fixed: set option defaults inside function body
                option.entity = option.entity || null;
                option.invoiceNo = option.invoiceNo || null;

                var entityId = option.entity || (Current.PO.DATA ? Current.PO.DATA.entity : null),
                    invoiceNo =
                        option.invoiceNo ||
                        (Current.BILLFILE.DATA ? Current.BILLFILE.DATA.invoice : null);

                vclib_util.log(logTitle, '// Search for existing bills: ', [
                    entityId,
                    invoiceNo,
                    option
                ]);
                // Fixed: use ERROR_LIST entry instead of hardcoded error string
                if (!entityId && !invoiceNo)
                    throw {
                        code: 'MISSING_PARAMETER',
                        details: 'entity or invoiceNo'
                    };

                var searchOption = {
                    type: ns_record.Type.VENDOR_BILL,
                    filters: [['type', 'anyof', 'VendBill'], 'AND', ['mainline', 'is', 'T']],
                    columns: ['internalid', 'tranid']
                };

                if (entityId) {
                    searchOption.filters.push('AND');
                    searchOption.filters.push(['mainname', 'anyof', entityId]);
                }
                if (invoiceNo) {
                    searchOption.filters.push('AND');
                    searchOption.filters.push(['numbertext', 'is', invoiceNo]);
                }

                var arrExistingBills = [];
                var vendorbillSearchObj = ns_search.create(searchOption);

                vendorbillSearchObj.run().each(function (result) {
                    arrExistingBills.push(result.getValue('internalid'));
                    return true;
                });

                // Fixed: empty array is truthy, so '-none-' would never display
                vclib_util.log(
                    logTitle,
                    '>> Existing Bill: ',
                    arrExistingBills.length ? arrExistingBills : '-none-'
                );
                returnValue = arrExistingBills;
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
                returnValue = false;
            }

            return returnValue;
        },
        processChargeLines: function (option) {
            var logTitle = [LogTitle, 'processChargeLines'].join('::'),
                returnValue = null;
            option = option || {};
            try {
                var varLines = option.varLines || Current.CHARGELINES;
                var taxVARLine;

                if (!Current.STATUS.BILLFILE.IsActiveEdit) return true;

                if (
                    // Not Billable
                    !Current.STATUS.PO.IsBillable &&
                    // Bill In Advance is disabled
                    !Current.CFG.Features.BILL_IN_ADV &&
                    // Not Receivable or not allowed to receive
                    (!Current.STATUS.PO.IsReceivable || !Current.STATUS.BILLFILE.AllowToReceive)
                )
                    return true;

                // if (vclib_util.isEmpty(Current.BILL.REC)) throw 'Missing vendor bill record';
                if (vclib_util.isEmpty(varLines)) throw 'Missing vendor bill charges';

                // User has opted to ignore all variance — skip even if HasVariance is true
                if (Current.STATUS.BILLFILE.IgnoreVariance) return;

                var salesOrderData =
                    Current.SO_DATA || Helper.getSalesOrderDetails({ id: Current.PO.ID });

                (varLines || []).forEach(function (varianceLine) {
                    if (
                        !vclib_util.isTrue(varianceLine.enabled) ||
                        !vclib_util.isTrue(varianceLine.applied)
                    ) {
                        return; // charge type disabled in config or applied flag = 'F'
                    }
                    if (varianceLine.amount <= 0) return; // no amount to add

                    // Tax variance is handled separately after other lines are added (taxVARLine)
                    if (vclib_util.inArray(varianceLine.type, [ChargeType.TAX])) {
                        taxVARLine = varianceLine;
                        return;
                    }

                    if (varianceLine.varianceAmount <= 0) return; // nothing to add

                    try {
                        // Build the line values: item, qty 1, rate = varianceAmount, customer, taxcode
                        var addLineOption = {
                            item: varianceLine.item,
                            quantity: 1,
                            rate: varianceLine.varianceAmount,
                            description: varianceLine.description
                        };
                        if (salesOrderData && salesOrderData.entity) {
                            addLineOption.customer =
                                salesOrderData.entity.value || salesOrderData.entity;
                        }

                        if (!vclib_util.isEmpty(Current.PO.DATA.TaxCode))
                            addLineOption.taxcode = Current.PO.DATA.TaxCode;

                        vclib_util.log(logTitle, '... adding line: ', [
                            varianceLine,
                            addLineOption,
                            varianceLine.taxcode,
                            Current.PO.DATA.TaxCode
                        ]);

                        var lineNo = varianceLine.lineno;
                        if (varianceLine.hasOwnProperty('lineno')) {
                            // Line already added in a prior run (REPROCESS) — update it in place
                            vcs_recordLib.updateLineValues({
                                record: Current.BILL.REC,
                                sublistId: 'item',
                                line: varianceLine.lineno,
                                values: addLineOption
                            });
                        } else {
                            // First time adding this charge — append a new line to the bill
                            lineNo = vcs_recordLib.addNewLine({
                                record: Current.BILL.REC,
                                sublistId: 'item',
                                values: addLineOption
                            });
                        }

                        // get the linevalues
                        var lineValue = vcs_recordLib.extractLineValues({
                            record: Current.BILL.REC,
                            sublistId: 'item',
                            line: lineNo,
                            columns: [
                                'line',
                                'linenumber',
                                'item',
                                'rate',
                                'quantity',
                                'amount',
                                'quantityreceived',
                                'quantitybilled',
                                'taxcode',
                                'taxrate',
                                'taxrate1',
                                'taxrate2'
                            ]
                        });
                        lineValue.taxamount = Helper.calculateLineTax(lineValue);
                        varianceLine.amounttax = lineValue.taxamount;
                        varianceLine.lineno = lineNo;

                        vclib_util.log(logTitle, '... added line: ', lineValue);
                    } catch (error) {
                        Helper.setError({
                            code: 'UNABLE_TO_ADD_VARIANCE_LINE',
                            detail: varianceLine.name
                        }).log(logTitle);
                    }
                });

                // // reload the bill data
                if (Current.BILL && Current.BILL.REC) this.loadBill();

                // now calculate the total
                // if tax is enabled and still not equal to Tax Total, we need to add the tax variance
                // if tax variance exists and is still needed (amount > 0), add a single tax adjustment line
                if (
                    taxVARLine &&
                    taxVARLine.enabled &&
                    taxVARLine.applied == 'T' &&
                    taxVARLine.amount > 0
                ) {
                    var taxVarianceAmt =
                        Helper.roundOff(taxVARLine.amount) -
                        Helper.roundOff(Current.TOTAL.BILL_TAX); // difference after non-tax lines settled

                    taxVARLine.calcAmount = Current.TOTAL.BILL_TAX;

                    vclib_util.log(logTitle, '>> Tax Variance: ', [
                        taxVarianceAmt,
                        [taxVARLine.amount, Current.TOTAL.BILL_TAX],
                        Helper.roundOff(taxVarianceAmt),
                        [
                            Helper.roundOff(taxVARLine.amount),
                            Helper.roundOff(Current.TOTAL.BILL_TAX)
                        ]
                    ]);

                    if (Math.abs(taxVarianceAmt)) {
                        // add the tax line
                        var lineNo = vcs_recordLib.addNewLine({
                            record: Current.BILL.REC,
                            sublistId: 'item',
                            values: {
                                item: taxVARLine.item,
                                quantity: 1,
                                rate: taxVarianceAmt,
                                description: taxVARLine.description,
                                taxcode: Current.PO.DATA.TaxCode
                            }
                        });
                        // update the tax line
                        var lineValue = vcs_recordLib.extractLineValues({
                            record: Current.BILL.REC,
                            sublistId: 'item',
                            line: lineNo,
                            columns: [
                                'line',
                                'linenumber',
                                'item',
                                'rate',
                                'quantity',
                                'amount',
                                'quantityreceived',
                                'quantitybilled',
                                'taxcode',
                                'taxrate',
                                'taxrate1',
                                'taxrate2'
                            ]
                        });
                        lineValue.taxamount = Helper.calculateLineTax(lineValue);
                        taxVARLine.amounttax = lineValue.taxamount;
                        taxVARLine.lineno = lineNo;
                    } else {
                        taxVARLine.calcAmount = taxVARLine.amount;
                        taxVARLine.varianceAmount = 0;
                        taxVARLine.amounttax = 0;
                    }
                }
            } catch (error) {
                // collect all the errors
                vclib_error.log(logTitle, error, ERROR_LIST);
            } finally {
                // calculate bill variance
            }
            return true;
        },
        reportError: function (option) {
            var logTitle = [LogTitle, 'reportError'].join('::'),
                returnValue = Current;

            var BILLCREATOR_ERROR = vc2_constant.Bill_Creator.Code;
            if (vclib_util.isEmpty(Current.VarianceList) && vclib_util.isEmpty(Current.ErrorList))
                return false;

            var processedErrorCodes = [],
                detectedErrors = [],
                detectedVariances = [];

            var errorReport = {
                errors: [],
                variance: [],
                notes: []
            };

            var _collectErrorMessages = function (errorCodes, option) {
                option = option || {};

                (errorCodes || []).forEach(function (errorCode) {
                    if (vclib_util.inArray(errorCode, processedErrorCodes)) return;
                    processedErrorCodes.push(errorCode);

                    var errorObj = vclib_error.interpret(
                            ERROR_LIST[errorCode] || BILLCREATOR_ERROR[errorCode] || errorCode
                        ),
                        errorMsg = errorObj.message;

                    if (option.includeDetails) {
                        var errorDetail = Current.Errors[errorCode] || [];
                        if (errorDetail.length > 0) {
                            errorMsg += ' -- ' + errorDetail.join(', ');
                        }
                    }

                    detectedErrors.push(errorMsg);
                });
            };

            // Get all the top errors first
            _collectErrorMessages(Current.ErrorList, { includeDetails: true });
            // get Errors from BillFileLines
            (Current.BILLFILE.LINES || []).forEach(function (billLine) {
                _collectErrorMessages(billLine.ErrorList);
            });

            var autoProcessed = [];
            detectedVariances = (Current.VarianceList || []).map(function (varianceCode) {
                var varianceMeta = Current.Variances[varianceCode] || [],
                    isAutoProcessed = vclib_util.inArray('AUTO', varianceMeta),
                    varianceLabel = VarianceType[varianceCode] || varianceCode;

                if (isAutoProcessed) autoProcessed.push(varianceCode);

                return varianceLabel + (isAutoProcessed ? '*' : '');
            });

            /// send the

            if (detectedErrors.length)
                errorReport.errors.push('Error(s): ' + detectedErrors.join('\n'));

            if (detectedVariances.length) {
                errorReport.variance.push('Variance(s): ' + detectedVariances.join(', '));
                // if (autoProcessed.length) errorReport.variance.push('* Auto-Processed');
            }

            if (
                !(Current.STATUS.AllowToBill || Current.STATUS.AllowToReceive) &&
                !vclib_util.isEmpty(Current.STATUS.REJECT_TO_BILL)
            ) {
                errorReport.notes.push(
                    'Reject Reason: ' +
                        (function () {
                            var reasons = [];
                            Current.STATUS.REJECT_TO_BILL.forEach(function (errorCode) {
                                reasons.push(
                                    vclib_error.interpret(
                                        ERROR_LIST[errorCode] ||
                                            BILLCREATOR_ERROR[errorCode] ||
                                            errorCode
                                    ).message
                                );
                            });
                            return reasons.join(', ');
                        })()
                );
            }
            if (Current.STATUS.AllowToBill && !vclib_util.isEmpty(Current.STATUS.ALLOWED_TO_BILL)) {
                errorReport.notes.push(
                    (function () {
                        var reasons = [];
                        Current.STATUS.ALLOWED_TO_BILL.forEach(function (errorCode) {
                            reasons.push(
                                vclib_error.interpret(
                                    ERROR_LIST[errorCode] ||
                                        BILLCREATOR_ERROR[errorCode] ||
                                        errorCode
                                ).message
                            );
                        });
                        return reasons.join(', ');
                    })()
                );
            }

            Current.STATUS.Report = errorReport;
            return errorReport;
        },
        calculateVariance: function (option) {
            var logTitle = [LogTitle, 'calculateVariance'].join('::'),
                returnValue = null;
            try {
                var BillFileLines = Current.BILLFILE && Current.BILLFILE.LINES,
                    ChargeLines = Current.CHARGELINES;

                var varianceFromLines = 0,
                    varianceFromCharges = 0,
                    lineAppliedTax = 0,
                    totalAppliedTax = 0;

                (BillFileLines || []).forEach(function (billFileLine) {
                    varianceFromLines += vclib_util.forceFloat(billFileLine.VarianceAmt);
                    lineAppliedTax += vclib_util.forceFloat(billFileLine.APPLIEDTAX);
                });

                (ChargeLines || []).forEach(function (chargeLine) {
                    varianceFromCharges += vclib_util.forceFloat(chargeLine.varianceAmount);
                    totalAppliedTax += vclib_util.forceFloat(chargeLine.amounttax);
                });

                var ActualVarianceAmt = Math.abs(
                    vclib_util.roundOff(Current.TOTAL.BILL_LINES) +
                        vclib_util.roundOff(Current.TOTAL.APPLIED_CHARGES) -
                        vclib_util.roundOff(Current.TOTAL.BILLFILE_TOTAL)
                );

                ns_util.extend(Current.TOTAL, {
                    VARIANCE_LINES: vclib_util.roundOff(varianceFromLines),
                    VARIANCE_CHARGES:
                        ActualVarianceAmt > 0
                            ? vclib_util.roundOff(varianceFromCharges)
                            : ActualVarianceAmt,
                    VARIANCE:
                        ActualVarianceAmt > 0
                            ? vclib_util.roundOff(varianceFromLines + varianceFromCharges)
                            : ActualVarianceAmt
                });

                if (ActualVarianceAmt <= 0) {
                    // Clear the Variance List
                    Current.Variances = {};
                    Current.VarianceList = [];
                }

                if (Current.TOTAL.VARIANCE != 0) Current.STATUS.HasVariance = true;
            } catch (error) {
                // collect all the errors
                vclib_error.log(logTitle, error, ERROR_LIST);
            } finally {
            }

            return returnValue;
        }
    };

    var Helper = {
        roundOff: function (amount) {
            return amount; //vclib_util.roundOff(amount, 4);
        },
        dumpCurrentData: function (option) {
            var logTitle = [LogTitle, 'dumpCurrentData'].join('::');

            vclib_util.log(logTitle, '###### DATA DUMP:start ######');
            // ['PO', 'BILL'].forEach(function (name) {
            //     vclib_util.log(logTitle, '##--[' + name + '.DATA]--##', Current[name].DATA);
            //     vclib_util.log(logTitle, '##--[' + name + '.LINES]--##', Current[name].LINES);
            // });
            vclib_util.dumpLog(logTitle, Current.BILLFILE.DATA, '##--[BILLFILE.DATA]--##');
            // vclib_util.dumpLog(logTitle, Current.BILLFILE.LINES, '##--[BILLFILE.LINES]--##');
            // vclib_util.dumpLog(logTitle, Current.CHARGELINES, '##--[CHARGELINES]--##');

            vclib_util.log(logTitle, '## CONFIG ##', Current.CFG);
            vclib_util.log(
                logTitle,
                '## CURRENT ##',
                vclib_util.extractValues({
                    source: Current,
                    params: [
                        'TOTAL',
                        'STATUS',
                        'CHARGES',
                        'VarianceList',
                        'Variances',
                        'ErrorList',
                        'Errors'
                    ]
                })
            );
            vclib_util.log(logTitle, '>> Errors: ', BillProcessLib.reportError());
            vclib_util.log(logTitle, '###### DATA DUMP:end ######');
        },
        setError: function (option, vendorLineBlock) {
            var logTitle = [LogTitle, 'setError'].join('::');

            var errorObj = vclib_error.interpret(option.error || option, ERROR_LIST),
                errorCode = option.code || option.errorCode || errorObj.code || 'UNKNOWN_ERROR',
                varianceCode = option.varianceCode || errorObj.varianceCode,
                vendorLine = option.vendorLine || vendorLineBlock || null;

            if (!Current.STATUS.HasCritical) {
                var isVariance = varianceCode || option.isVariance || false,
                    isError = !isVariance,
                    isCritical =
                        errorObj.level && errorObj.level === vclib_error.ErrorLevel.CRITICAL;

                if (isCritical) Current.STATUS.HasCritical = true;
                [vendorLine, Current].forEach(function (errorBlock) {
                    if (!errorBlock) return;

                    var errorDetail = errorObj && (errorObj.detail || errorObj.details),
                        errorMsg = errorObj && (errorObj.msg || errorObj.message || errorCode);

                    if (!vclib_util.isEmpty(errorDetail))
                        errorDetail = ns_util.isString(errorDetail)
                            ? errorDetail.trim()
                            : JSON.stringify(errorDetail);

                    // Push detail into Errors or Variances map (dedup by details value)
                    if (isVariance) {
                        var varCode = varianceCode || errorCode;

                        if (!vclib_util.inArray(varCode, errorBlock.VarianceList))
                            errorBlock.VarianceList.push(varCode);

                        if (!vclib_util.isEmpty(errorDetail)) {
                            if (!errorBlock.Variances[varCode]) errorBlock.Variances[varCode] = [];

                            if (!vclib_util.inArray(errorDetail, errorBlock.Variances[varCode]))
                                errorBlock.Variances[varCode].push(errorDetail);
                        }
                    } else if (isError) {
                        if (!vclib_util.inArray(errorCode, errorBlock.ErrorList))
                            errorBlock.ErrorList.push(errorCode);

                        if (!vclib_util.isEmpty(errorDetail)) {
                            if (!errorBlock.Errors[errorCode]) errorBlock.Errors[errorCode] = [];
                            if (!vclib_util.inArray(errorDetail, errorBlock.Errors[errorCode]))
                                errorBlock.Errors[errorCode].push(errorDetail);
                        }
                    }
                });
            }

            return errorObj;
        },
        calculateLineTax: function (option) {
            var amount = option.amount,
                taxRate1 = option.taxrate1 || false,
                taxRate2 = option.taxrate2 || false;

            var taxAmount = taxRate1 ? (taxRate1 / 100) * amount : 0;
            taxAmount += taxRate2 ? (taxRate2 / 100) * amount : 0;

            return taxAmount ? taxAmount : 0;
        },
        getSalesOrderDetails: function (option) {
            var logTitle = [LogTitle, 'getSalesOrderDetails'].join('::'),
                returnValue;
            option = option || {};

            try {
                var poId = option.poId || Current.PO.ID,
                    createdFromId =
                        option.createdFromId || option.soId || Current.PO.DATA.createdfrom;

                if (!createdFromId) throw 'Missing Created From ID';

                /// do a lookup on the sales order
                var salesOrderData = vclib_util.flatLookup({
                    type: 'transaction',
                    id: createdFromId,
                    columns: ['entity', 'tranid', 'total']
                });

                vclib_util.log(logTitle, '>> SO Details: ', salesOrderData);
                returnValue = salesOrderData;

                // seach for the sales order details
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        processInventoryDetails: function (option) {
            var logTitle = [LogTitle, 'processInventoryDetails'].join('::'),
                returnValue;

            option = option || {};

            try {
                var record = option.record,
                    lineNo = option.lineNo,
                    appliedQty = option.appliedQty,
                    serialNos = option.serials || option.serialNumbers || [];

                if (!record) throw 'Missing parameter: record';
                if (vclib_util.isEmpty(lineNo)) throw 'Missing parameter: lineNo';
                if (!appliedQty) throw 'Missing parameter: appliedQty';

                var lineData = vcs_recordLib.extractLineValues({
                    record: record,
                    line: lineNo,
                    columns: [
                        'item',
                        'quantity',
                        'binitem',
                        'orderline',
                        'itemname',
                        'lineuniquekey',
                        'location',
                        'inventorydetailreq',
                        'inventorydetailavail',
                        'inventorydetailset',
                        'poline',
                        'isserial'
                    ]
                });

                if (
                    !vclib_util.inArray(lineData.isserial, ['T', 't']) &&
                    !vclib_util.inArray(lineData.inventorydetailavail, ['T', 't']) &&
                    !vclib_util.inArray(lineData.inventorydetailreq, ['T', 't'])
                )
                    throw ERROR_LIST.LINE_NO_INVENTORY_REQUIRED;

                record.selectLine({ sublistId: 'item', line: lineNo });
                var invDetailSubrec = record.getCurrentSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail'
                });

                // fetch the current serials, if available
                var inventoryAssignmentQty = 0;
                var appliedSerials = (function () {
                    var serials = [],
                        linesToDelete = [],
                        serialCount = invDetailSubrec.getLineCount({
                            sublistId: 'inventoryassignment'
                        });

                    for (var i = 0; i < serialCount; i++) {
                        inventoryAssignmentQty +=
                            +invDetailSubrec.getSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'quantity',
                                line: i
                            }) || 0;
                        if (serials.length >= appliedQty) {
                            linesToDelete.push(i);
                            continue;
                        }

                        var serialNum = invDetailSubrec.getSublistValue({
                            sublistId: 'inventoryassignment',
                            fieldId: 'receiptinventorynumber',
                            line: i
                        });
                        if (!serialNum) continue;

                        // If no specific serials are required, keep all existing serials
                        if (vclib_util.isEmpty(serialNos)) {
                            serials.push(serialNum);
                        } else {
                            // Only keep serials that match the required serial numbers
                            if (vclib_util.inArray(serialNum, serialNos)) {
                                serials.push(serialNum);
                            } else {
                                linesToDelete.push(i);
                            }
                        }
                    }

                    if (linesToDelete.length) {
                        vclib_util.log(logTitle, '>> Removing lines: ', linesToDelete);
                        for (var j = linesToDelete.length - 1; j >= 0; j--) {
                            invDetailSubrec.removeLine({
                                sublistId: 'inventoryassignment',
                                line: linesToDelete[j]
                            });
                        }
                        // invDetailSubrec.commitLine({ sublistId: 'inventoryassignment' });
                        // record.commitLine({ sublistId: 'item' });
                    }

                    return serials;
                })();

                // Check if we have applied serials
                if (appliedSerials.length > 0) {
                    // Verify that the applied serial count matches the applied quantity
                    if (appliedSerials.length !== appliedQty) {
                        throw (
                            'Serial count mismatch: Expected ' +
                            appliedQty +
                            ' serials, but found ' +
                            appliedSerials.length
                        );
                    }
                } else {
                    // No applied serials found, add serials from serialNos if available
                    if (inventoryAssignmentQty > 0) {
                        // No applied serials but bin/lot/inventory status found
                        vclib_util.log(logTitle, 'Other inventory detail found.', {
                            existing: inventoryAssignmentQty,
                            appliedQty: appliedQty,
                            newAppliedQty: appliedQty - inventoryAssignmentQty
                        });
                        appliedQty -= inventoryAssignmentQty;
                    }
                    if (!vclib_util.isEmpty(serialNos) && appliedQty > 0) {
                        var serialsToAdd = serialNos.slice(0, appliedQty); // Only take what we need

                        for (var k = 0; k < serialsToAdd.length; k++) {
                            invDetailSubrec.selectNewLine({ sublistId: 'inventoryassignment' });
                            invDetailSubrec.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'receiptinventorynumber',
                                value: serialsToAdd[k]
                            });
                            invDetailSubrec.setCurrentSublistValue({
                                sublistId: 'inventoryassignment',
                                fieldId: 'quantity',
                                value: 1
                            });
                            invDetailSubrec.commitLine({ sublistId: 'inventoryassignment' });
                        }

                        vclib_util.log(logTitle, '>> Added serial numbers: ', serialsToAdd);
                    }
                }

                vclib_util.log(logTitle, '>> Current Serial Numbers: ', appliedSerials);
            } catch (error) {
                vclib_error.log(logTitle, error, ERROR_LIST);
            }

            return returnValue;
        },
        isShippingLineHelper: function (lineValue, chargesDef) {
            if (!lineValue) return false;

            var itemText = (lineValue.item_text || '').toLowerCase();
            var isShipByName =
                itemText.indexOf('shipping') !== -1 || itemText.indexOf('freight') !== -1;

            var isShipByItem =
                chargesDef &&
                chargesDef.shipping &&
                chargesDef.shipping.item &&
                chargesDef.shipping.item === lineValue.item;

            return isShipByName || isShipByItem;
        }
    };

    return BillProcessLib;
});
