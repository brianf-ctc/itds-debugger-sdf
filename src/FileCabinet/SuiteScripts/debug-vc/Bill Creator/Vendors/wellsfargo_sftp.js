/**
 * Copyright (c) 2025 Catalyst Tech Corp
 * All Rights Reserved.
 *
 * This software is the confidential and proprietary information of
 * Catalyst Tech Corp. ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in
 * accordance with the terms of the license agreement you entered into
 * with Catalyst Tech.
 *
 * Module Name: VC Bill Creator | Wells Fargo SFTP
 * @author brianf@nscatalyst.com
 * @description Vendor connector for Wells Fargo SFTP-based remittance and transaction files.
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */

define(function (require) {
    var ns_sftp = require('N/sftp'),
        ns_encode = require('N/encode');

    var vc2_util = require('../../CTC_VC2_Lib_Utils'),
        lodash = require('../Libraries/lodash'),
        moment = require('../Libraries/moment');

    var LogTitle = 'WS:WellsFargoSFTP',
        LogPrefix,
        CURRENT = {};

    var Helper = {
        trimPadding: function (str, char) {
            if (!char) {
                char = ' ';
            }
            var padChar = char;
            var trimLeftInt = 0;
            var trimRightInt = str.length;

            for (var i = 0; i < str.length; i++) {
                if (str[i] == padChar) {
                    trimLeftInt = i + 1;
                } else {
                    break;
                }
            }

            for (var i = str.length - 1; i > 0; i--) {
                if (str[i] == padChar) {
                    trimRightInt = i;
                } else {
                    break;
                }
            }

            var cleanStr = str.slice(trimLeftInt, trimRightInt);
            return cleanStr;
        },
        underPunchString: function (str) {
            if (!str || str == '') {
                return 0;
            }

            var firstPart = str.slice(0, str.length - 1);
            var lastPart = str.slice(str.length - 1, str.length);

            var map = {
                '{': '0',
                A: '1',
                B: '2',
                C: '3',
                D: '4',
                E: '5',
                F: '6',
                G: '7',
                H: '8',
                I: '9',
                '}': '0',
                J: '1',
                K: '2',
                L: '3',
                M: '4',
                N: '5',
                O: '6',
                P: '7',
                Q: '8',
                R: '9'
            };

            var newStr;

            var lp = lastPart;

            if (
                lp == '}' ||
                lp == 'J' ||
                lp == 'K' ||
                lp == 'L' ||
                lp == 'M' ||
                lp == 'N' ||
                lp == 'O' ||
                lp == 'P' ||
                lp == 'Q' ||
                lp == 'R'
            ) {
                newStr = (firstPart + map[lastPart]) * -0.01;
            } else {
                newStr = (firstPart + map[lastPart]) * 0.01;
            }
            return newStr.toFixed(2) * 1;
        }
    };

    var LibWellsFargo = {
        getFileContent: function (option) {
            var logTitle = [LogTitle, 'getFileContent'].join('::'),
                returnValue;

            try {
                var configObj = option.configObj,
                    fileName = option.fileName;

                // establish the connection
                var conn = ns_sftp.createConnection({
                    username: configObj.user_id,
                    passwordGuid: configObj.user_pass,
                    url: configObj.url,
                    directory: configObj.res_path,
                    hostKey: configObj.host_key
                });

                if (!conn) throw 'Failed to establish connection';

                var fileDownloaded = conn.download({ filename: option.fileName });
                if (!fileDownloaded) throw 'Failed to download file';

                var fileContent = fileDownloaded.getContents();
                if (!fileContent) throw 'Failed to get file content';

                returnValue = fileContent;

                // cleanup the content
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        },
        parseLine: function (lineStr) {
            var lineType = lineStr.slice(0, 6);

            var returnObj = {};

            switch (lineType) {
                case 'HDRH10':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.invoice_date = Helper.trimPadding(lineStr.slice(27, 33));
                    returnObj.invoice_number_two = Helper.trimPadding(lineStr.slice(33, 44));
                    returnObj.purchase_order_number = Helper.trimPadding(lineStr.slice(44, 64));
                    returnObj.invoice_type_indicator = Helper.trimPadding(lineStr.slice(64, 66));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(66, 74));
                    returnObj.ge_distributor_number = Helper.trimPadding(lineStr.slice(74, 80));
                    returnObj.repurchase_flag = Helper.trimPadding(lineStr.slice(80, 81));
                    returnObj.transaction_type = Helper.trimPadding(lineStr.slice(81, 82));
                    returnObj.filler_two = Helper.trimPadding(lineStr.slice(82, 194));
                    break;

                // case 'HDRH20':

                //   returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                //   returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                //   returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                //   returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                //   returnObj.qualifier = Helper.trimPadding(lineStr.slice(27, 29));
                //   returnObj.reference_number = Helper.trimPadding(lineStr.slice(29, 59));
                //   returnObj.program_type_reference_name = Helper.trimPadding(lineStr.slice(59, 79));
                //   returnObj.filler = Helper.trimPadding(lineStr.slice(79, 89));
                //   returnObj.vat_amt_field = Helper.underPunchString(Helper.trimPadding(lineStr.slice(89, 100)));
                //   returnObj.filler_two = Helper.trimPadding(lineStr.slice(100, 194));
                //   break;

                // case 'HDRH30':

                //   returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                //   returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                //   returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                //   returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                //   returnObj.qualifier = Helper.trimPadding(lineStr.slice(27, 29));
                //   returnObj.name = Helper.trimPadding(lineStr.slice(29, 64));
                //   returnObj.buyer_qualifier_code = Helper.trimPadding(lineStr.slice(64, 66));
                //   returnObj.ge_assigned_number = Helper.trimPadding(lineStr.slice(66, 80));
                //   returnObj.filler = Helper.trimPadding(lineStr.slice(80, 194));
                //   break;

                case 'HDRH66':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.payment_amount_qualifier = Helper.trimPadding(lineStr.slice(27, 29));
                    returnObj.scheduled_payment_date = Helper.trimPadding(lineStr.slice(29, 37));
                    returnObj.scheduled_payment_amount = Helper.trimPadding(lineStr.slice(37, 51));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(51, 57));
                    returnObj.late_charge_text = Helper.trimPadding(lineStr.slice(57, 77));
                    returnObj.filler_two = Helper.trimPadding(lineStr.slice(77, 79));
                    returnObj.epd_rate = Helper.trimPadding(lineStr.slice(79, 85));
                    returnObj.epd_payment_date = Helper.trimPadding(lineStr.slice(85, 91));
                    returnObj.epd_amount = Helper.trimPadding(lineStr.slice(91, 4));
                    returnObj.epd_refund_pay_amount = Helper.trimPadding(lineStr.slice(4, 111));
                    returnObj.epd_days = Helper.trimPadding(lineStr.slice(121, 124));
                    returnObj.epd_rate_with_decimal = Helper.trimPadding(lineStr.slice(124, 131));
                    returnObj.filler_three = Helper.trimPadding(lineStr.slice(131, 194));
                    break;

                case 'DTLD10':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.line_number = Helper.trimPadding(lineStr.slice(27, 31));
                    returnObj.line_quantity = Helper.trimPadding(lineStr.slice(31, 41)) * 1;
                    returnObj.unit_of_measure = Helper.trimPadding(lineStr.slice(41, 43));
                    returnObj.line_amount = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(43, 54))
                    );
                    returnObj.product_code_qualifier = Helper.trimPadding(lineStr.slice(54, 56));
                    returnObj.model_number = Helper.trimPadding(lineStr.slice(56, 80));
                    returnObj.po_line_number = Helper.trimPadding(lineStr.slice(80, 86));
                    returnObj.unit_price = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(86, 97))
                    );
                    returnObj.dad03_unit_price = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(97, 110))
                    );
                    returnObj.dad03_quantity = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(110, 124))
                    );
                    returnObj.duration_months = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(124, 135))
                    );
                    returnObj.contract_start_date = Helper.trimPadding(lineStr.slice(135, 145));
                    returnObj.contract_end_date = Helper.trimPadding(lineStr.slice(145, 155));
                    returnObj.line_transaction_type = Helper.trimPadding(lineStr.slice(155, 156));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(156, 194));
                    break;

                case 'DTLD11':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.invoice_line_number = Helper.trimPadding(lineStr.slice(27, 31));
                    returnObj.mfg_part_number_qualifier = Helper.trimPadding(lineStr.slice(31, 33));
                    returnObj.mfg_part_number = Helper.trimPadding(lineStr.slice(33, 43));
                    returnObj.sku_id_qualifier = Helper.trimPadding(lineStr.slice(43, 45));
                    returnObj.sku_id = Helper.trimPadding(lineStr.slice(45, 69));
                    returnObj.mfg_number_qualifier = Helper.trimPadding(lineStr.slice(69, 17));
                    returnObj.mfg_number = Helper.trimPadding(lineStr.slice(71, 77));
                    returnObj.distributor_number_qualifier = Helper.trimPadding(
                        lineStr.slice(77, 79)
                    );
                    returnObj.distributor_number = Helper.trimPadding(lineStr.slice(79, 85));
                    returnObj.program_code_qualifier = Helper.trimPadding(lineStr.slice(85, 87));
                    returnObj.program_number = Helper.trimPadding(lineStr.slice(87, 92));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(92, 194));
                    break;

                case 'DTLD15':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.invoice_line_number = Helper.trimPadding(lineStr.slice(27, 31));
                    returnObj.product_discription_qualifier = Helper.trimPadding(
                        lineStr.slice(31, 32)
                    );
                    returnObj.product_discription = Helper.trimPadding(lineStr.slice(32, 80));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(80, 194));
                    break;

                case 'DTLD40':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.serial_number_qualifier = Helper.trimPadding(lineStr.slice(27, 29));
                    returnObj.serial_number = Helper.trimPadding(lineStr.slice(29, 59));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(59, 194));
                    break;

                case 'DTLD41':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.mfg_part_number = Helper.trimPadding(lineStr.slice(27, 51));
                    returnObj.vendor_part_number = Helper.trimPadding(lineStr.slice(51, 71));
                    returnObj.vendor_upc_number = Helper.trimPadding(lineStr.slice(71, 91));
                    returnObj.scac_code = Helper.trimPadding(lineStr.slice(91, 95));
                    returnObj.extended_model_number = Helper.trimPadding(lineStr.slice(95, 125));
                    returnObj.serial_number = Helper.trimPadding(lineStr.slice(125, 145));
                    returnObj.vendor_code_number = Helper.trimPadding(lineStr.slice(145, 149));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(149, 194));
                    break;

                case 'DTLD42':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.line_level_ship_via_desc = Helper.trimPadding(lineStr.slice(27, 47));
                    returnObj.ship_trace_number = Helper.trimPadding(lineStr.slice(47, 72));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(72, 194));
                    break;

                case 'DTLD43':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.tax_qualifier = Helper.trimPadding(lineStr.slice(27, 29));
                    returnObj.tax_amount = Helper.trimPadding(lineStr.slice(29, 40));
                    returnObj.tax_type = Helper.trimPadding(lineStr.slice(40, 42));
                    returnObj.tax_rate = Helper.trimPadding(lineStr.slice(42, 47));
                    returnObj.filler = Helper.trimPadding(lineStr.slice(47, 194));
                    break;

                case 'SUMS10':
                    returnObj.rec_type = Helper.trimPadding(lineStr.slice(0, 6));
                    returnObj.issue_ge_branch_nbr = Helper.trimPadding(lineStr.slice(6, 10));
                    returnObj.dealer_number = Helper.trimPadding(lineStr.slice(10, 16));
                    returnObj.invoice_number = Helper.trimPadding(lineStr.slice(16, 27));
                    returnObj.invoice_amount = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(27, 37))
                    );
                    returnObj.finance_charge = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(37, 48))
                    );
                    returnObj.tax_type = Helper.trimPadding(lineStr.slice(48, 50));
                    returnObj.vat_amt = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(50, 61))
                    );
                    returnObj.vat_rate = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(61, 66))
                    );
                    returnObj.filler = Helper.trimPadding(lineStr.slice(66, 74));
                    returnObj.distributor_number = Helper.trimPadding(lineStr.slice(74, 80));
                    returnObj.filler_two = Helper.trimPadding(lineStr.slice(80, 81));
                    returnObj.qst_pst_tax_qualifier = Helper.trimPadding(lineStr.slice(81, 83));
                    returnObj.qst_pst_tax_amount = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(83, 94))
                    );
                    returnObj.all_tax_qualifier = Helper.trimPadding(lineStr.slice(94, 96));
                    returnObj.tax_amount = Helper.underPunchString(
                        Helper.trimPadding(lineStr.slice(96, 107))
                    );
                    returnObj.model_number_qualifier = Helper.trimPadding(lineStr.slice(107, 109));
                    returnObj.model_number = Helper.trimPadding(lineStr.slice(109, 139));
                    returnObj.manufacturer_number_qualifier = Helper.trimPadding(
                        lineStr.slice(139, 141)
                    );
                    returnObj.manufacturer_number = Helper.trimPadding(lineStr.slice(141, 147));
                    returnObj.distributor_number_qualifier = Helper.trimPadding(
                        lineStr.slice(147, 149)
                    );
                    returnObj.distributor_number = Helper.trimPadding(lineStr.slice(149, 155));
                    returnObj.program_code_qualifier = Helper.trimPadding(lineStr.slice(155, 157));
                    returnObj.program_number = Helper.trimPadding(lineStr.slice(157, 162));
                    returnObj.filler_two = Helper.trimPadding(lineStr.slice(162, 194));
                    break;
            }
            return returnObj;
        }
    };
    // Add the return statement that identifies the entry point function.
    return {
        processXml: function (fileName, configObj) {
            var logTitle = [LogTitle, 'processXml'].join('::'),
                returnValue = [];

            LogPrefix = '[' + ['sftp_file', fileName].join(':') + '] ';
            vc2_util.LogPrefix = LogPrefix;

            var fileContent = LibWellsFargo.getFileContent({
                fileName: fileName,
                configObj: configObj
            });

            xmlStr = ns_encode.convert({
                string: fileContent,
                inputEncoding: ns_encode.Encoding.BASE_64,
                outputEncoding: ns_encode.Encoding.UTF_8
            });

            var fileObj = xmlStr.split(/\r?\n/);

            lodash.reverse(fileObj);

            var tmpArray = [];

            tmpArray.push('end_of_transaction');

            // we've pulled down the file, now lets pre-process it to deal with wf craziness
            fileObj.forEach(function (lineStr) {
                var lineObj = LibWellsFargo.parseLine(lineStr);

                if (lineObj.hasOwnProperty('rec_type')) {
                    tmpArray.push(lineObj);

                    if (lineObj.rec_type == 'HDRH10') {
                        tmpArray.push('end_of_transaction');
                    }
                }
            });

            lodash.reverse(tmpArray);

            if (typeof tmpArray[0] == 'string') {
                // since we flipped the array we need to make sure we're not starting with an end of transaction marker
                tmpArray.splice(0, 1);
            }

            var xmlArr = [];

            trxObj = {};
            trxObj.HDRH10 = {};
            trxObj.HDRH66 = [];
            trxObj.DTLD10 = [];
            trxObj.SUMS10 = [];
            var lastDTLD10 = 0;

            tmpArray.forEach(function (lineObj) {
                if (typeof lineObj == 'string') {
                    // we've hit the end of a transaction - push the object and reset values
                    xmlArr.push(trxObj);
                    trxObj = {};
                    trxObj.HDRH10 = {};
                    trxObj.HDRH66 = [];
                    trxObj.DTLD10 = [];
                    trxObj.SUMS10 = [];
                    lastDTLD10 = 0;

                    return;
                } else {
                    switch (lineObj.rec_type) {
                        case 'HDRH10':
                            trxObj.HDRH10 = lineObj;
                            break;

                        case 'HDRH66':
                            trxObj.HDRH66.push(lineObj);
                            break;

                        case 'DTLD10':
                            lastDTLD10 = trxObj.DTLD10.push(lineObj) - 1;
                            trxObj.DTLD10[lastDTLD10].DTLD40 = [];
                            trxObj.DTLD10[lastDTLD10].DTLD42 = [];
                            break;

                        case 'DTLD11':
                            trxObj.DTLD10[lastDTLD10].DTLD11 = lineObj;
                            break;

                        case 'DTLD15':
                            trxObj.DTLD10[lastDTLD10].DTLD15 = lineObj;
                            break;

                        case 'DTLD40':
                            trxObj.DTLD10[lastDTLD10].DTLD40.push(lineObj);
                            break;

                        case 'DTLD41':
                            trxObj.DTLD10[lastDTLD10].DTLD41 = lineObj;
                            break;

                        case 'DTLD42':
                            trxObj.DTLD10[lastDTLD10].DTLD42.push(lineObj);
                            break;

                        case 'DTLD43':
                            trxObj.DTLD10[lastDTLD10].DTLD43 = lineObj;
                            break;

                        case 'SUMS10':
                            trxObj.SUMS10.push(lineObj);
                            break;
                    }
                }
            });

            var returnArr = [];

            xmlArr.forEach(function (xmlLine) {
                var ordObj = {};

                var HDRH10 = xmlLine.HDRH10;
                var HDRH66 = xmlLine.HDRH66;
                var DTLD10 = xmlLine.DTLD10;
                var SUMS10 = xmlLine.SUMS10;

                ordObj.date = moment(HDRH10.invoice_date, 'YYMMDD').format('MM/DD/YYYY');
                ordObj.invoice = HDRH10.invoice_number;
                ordObj.po = HDRH10.purchase_order_number;
                ordObj.charges = {};
                ordObj.charges.tax = 0;
                ordObj.charges.shipping = 0;
                ordObj.charges.other = 0;

                // set due date if it exists
                for (var h = 0; h < HDRH66.length; h++) {
                    if (HDRH66[h].payment_amount_qualifier == 'ZZ') {
                        ordObj.duedate = moment(
                            HDRH66[h].scheduled_payment_date,
                            'YYYYMMDD'
                        ).format('MM/DD/YYYY');
                    }
                }

                ordObj.total = SUMS10[0].invoice_amount;

                // if the bill is less then or equal to $0 then skip it
                if (ordObj.total <= 0) {
                    return;
                }

                SUMS10.forEach(function (sums_10, ctr) {
                    if (sums_10.model_number == 'FREIGHT') {
                        ordObj.charges.shipping += sums_10.finance_charge;
                    }
                    if (sums_10.model_number == 'TAX') {
                        ordObj.charges.tax += sums_10.finance_charge;
                    }
                    if (sums_10.model_number == 'MISCELLANEOUS') {
                        ordObj.charges.other += sums_10.finance_charge;
                    }

                    return true;
                });
                ordObj.lines = [];

                DTLD10.forEach(function (dtld10) {
                    // don't create bill lines if they don't have an amount;
                    if (dtld10.line_amount == 0) {
                        return;
                    }

                    var lineObj = {};
                    lineObj.SERIAL = [];
                    lineObj.TRACKING = [];
                    lineObj.CARRIER = '';

                    lineObj.ITEMNO = dtld10.model_number;

                    if (dtld10.hasOwnProperty('DTLD41')) {
                        if (dtld10.DTLD41.mfg_part_number && dtld10.DTLD41.mfg_part_number !== '') {
                            lineObj.ITEMNO = dtld10.DTLD41.mfg_part_number;
                        }
                        if (dtld10.DTLD41.scac_code !== '') {
                            lineObj.CARRIER = dtld10.DTLD41.scac_code;
                        }

                        if (
                            dtld10.DTLD41.extended_model_number &&
                            dtld10.DTLD41.extended_model_number !== ''
                        ) {
                            lineObj.ITEMNO_EXT = dtld10.DTLD41.extended_model_number;
                        }
                    }

                    if (dtld10.hasOwnProperty('DTLD15')) {
                        lineObj.DESCRIPTION = dtld10.DTLD15.product_discription;
                    } else {
                        lineObj.DESCRIPTION = 'Not Included in Vendor Feed';
                    }

                    lineObj.PRICE = dtld10.unit_price;
                    lineObj.QUANTITY = dtld10.line_quantity;

                    // add any serial numbers
                    if (dtld10.hasOwnProperty('DTLD40')) {
                        dtld10.DTLD40.forEach(function (dtld40) {
                            if (
                                dtld40.serial_number_qualifier == 'SE' &&
                                dtld40.serial_number !== ''
                            ) {
                                lineObj.SERIAL.push(dtld40.serial_number);
                            }
                        });
                    }

                    // add any tracking information
                    if (dtld10.hasOwnProperty('DTLD42')) {
                        dtld10.DTLD42.forEach(function (dtld42) {
                            if (dtld42.ship_trace_number !== '') {
                                lineObj.TRACKING.push(dtld42.ship_trace_number);
                            }
                        });
                    }

                    lineObj.processed = false;

                    var itemIdx = lodash.findIndex(ordObj.lines, {
                        ITEMNO: lineObj.ITEMNO,
                        PRICE: lineObj.PRICE
                    });

                    if (itemIdx !== -1) {
                        ordObj.lines[itemIdx].QUANTITY += lineObj.QUANTITY;

                        lineObj.SERIAL.forEach(function (serial) {
                            ordObj.lines[itemIdx].SERIAL.push(serial);
                        });

                        lineObj.TRACKING.forEach(function (tracking) {
                            ordObj.lines[itemIdx].TRACKING.push(tracking);
                        });

                        if ((ordObj.lines[itemIdx].CARRIER = '' && lineObj.CARRIER !== '')) {
                            ordObj.lines[itemIdx].CARRIER = lineObj.CARRIER;
                        }
                    } else {
                        ordObj.lines.push(lineObj);
                    }
                });

                returnArr.push({
                    ordObj: ordObj,
                    xmlStr: JSON.stringify(xmlLine)
                });
            });

            return returnArr;
        },

        processXml_new: function (fileName, configObj) {
            var logTitle = [LogTitle, 'processXml'].join('::'),
                returnValue = [];

            LogPrefix = '[' + ['purchaseorder', fileName].join(':') + '] ';
            vc2_util.LogPrefix = LogPrefix;

            try {
                util.extend(CURRENT, {
                    fileName: fileName,
                    billConfig: configObj
                });
                vc2_util.log(logTitle, '############ WELLSFARGO: START ############');

                var fileContent = LibWellsFargo.getFileContent({
                    fileName: fileName,
                    configObj: configObj
                });

                returnValue = this.extractBills({ content: fileContent });
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            } finally {
                vc2_util.log(logTitle, '############ WELLSFARGO: END ############');
            }

            return returnValue;
        },

        extractBills: function (option) {
            var logTitle = [LogTitle, 'extractBills'].join('::'),
                returnValue = [];

            try {
                var content = option.content;
                if (!content) throw 'Invalid content';

                try {
                    content = ns_encode.convert({
                        string: content,
                        inputEncoding: ns_encode.Encoding.BASE_64,
                        outputEncoding: ns_encode.Encoding.UTF_8
                    });
                } catch (sanitize_error) {
                    vc2_util.logError(logTitle, sanitize_error);
                }

                var arrLines = content.split('\n');
                if (!arrLines || !arrLines.length) throw 'Invalid content';

                var arrTxnList = [],
                    lastDTLD10 = 0;

                // process each line
                arrLines.forEach(function (lineStr) {
                    var parsedLine = LibWellsFargo.parseLine(lineStr);
                    if (!parsedLine || !parsedLine.line_type) return;

                    var lineType = parsedLine.line_type;

                    if (lineType === 'HDRH10') {
                        // reset new object
                        arrTxnList.push({
                            HDRH10: parsedLine,
                            HDRH66: [],
                            DTLD10: [],
                            SUMS10: []
                        });
                        lastDTLD10 = 0;
                    }
                    var currentObj = arrTxnList[arrTxnList.length - 1];
                    if (!currentObj) return;

                    switch (lineType) {
                        case 'HDRH66':
                            currentObj.HDRH66.push(parsedLine);
                            break;
                        case 'DTLD10':
                            currentObj.DTLD10.push(
                                util.extend(parsedLine, {
                                    DTLD40: [],
                                    DTLD42: []
                                })
                            );
                            break;
                        case 'DTLD11':
                        case 'DTLD15':
                        case 'DTLD41':
                        case 'DTLD43':
                            currentObj.DTLD10[currentObj.DTLD10.length - 1][lineType] = parsedLine;
                            break;
                        case 'DTLD40':
                        case 'DTLD42':
                            currentObj.DTLD10[currentObj.DTLD10.length - 1][lineType].push(
                                parsedLine
                            );
                            break;

                        case 'SUMS10':
                            currentObj.SUMS10.push(parsedLine);
                            break;
                        default:
                            break;
                    }
                });

                var returnArr = [];
                arrTxnList.forEach(function (txnObj) {
                    var orderObj = {
                        date: vc2_util.parseToVCDate(txnObj.HDRH10.invoice_date, 'YYMMDD'),
                        invoice: txnObj.HDRH10.invoice_number,
                        po: txnObj.HDRH10.purchase_order_number || '', // adding PO number from HDRH10
                        charges: (function (SUMS10) {
                            var charges = {
                                tax: 0,
                                shipping: 0,
                                other: 0
                            };
                            SUMS10.forEach(function (sums_10) {
                                if (sums_10.model_number == 'FREIGHT') {
                                    charges.shipping += sums_10.finance_charge;
                                }
                                if (sums_10.model_number == 'TAX') {
                                    charges.tax += sums_10.finance_charge;
                                }
                                if (sums_10.model_number == 'MISCELLANEOUS') {
                                    charges.other += sums_10.finance_charge;
                                }

                                return true;
                            });
                            return charges;
                        })(txnObj.SUMS10),
                        duedate: (function (HDRH66) {
                            var dueDate;
                            HDRH66.forEach(function (charge) {
                                if (
                                    charge.payment_amount_qualifier === 'ZZ' &&
                                    charge.scheduled_payment_date
                                ) {
                                    dueDate = vc2_util.parseToVCDate(
                                        charge.scheduled_payment_date,
                                        'YYYYMMDD'
                                    );
                                }
                            });
                            return dueDate || '';
                        })(txnObj.HDRH66),
                        duedate_raw: txnObj.HDRH66[0].scheduled_payment_date,
                        total: txnObj.SUMS10[0].invoice_amount,
                        lines: (function (DTLD10) {
                            var invoiceLines = [];

                            DTLD10.forEach(function (dtld_10) {
                                var lineObj = {
                                    SERIAL: [],
                                    TRACKING: [],
                                    CARRIER: '',
                                    ITEMNO: dtld_10.model_number,
                                    DESCRIPTION:
                                        dtld_10.DTLD15 && dtld_10.DTLD15.product_discription
                                            ? dtld_10.DTLD15.product_discription
                                            : '',
                                    PRICE: dtld_10.unit_price,
                                    QUANTITY: vc2_util.forceInt(dtld_10.line_quantity),
                                    processed: false
                                };

                                if (dtld_10.DTLD41) {
                                    if (dtld_10.DTLD41.mfg_part_number)
                                        lineObj.ITEMNO = dtld_10.DTLD41.mfg_part_number;

                                    if (dtld_10.DTLD41.scac_code)
                                        lineObj.CARRIER = dtld_10.DTLD41.scac_code;

                                    if (
                                        dtld_10.DTLD41.extended_model_number &&
                                        dtld_10.DTLD41.extended_model_number !== ''
                                    )
                                        lineObj.ITEMNO_EXT = dtld_10.DTLD41.extended_model_number;
                                }

                                if (dtld_10.DTLD40) {
                                    dtld_10.DTLD40.forEach(function (dtld40) {
                                        if (
                                            dtld40.serial_number_qualifier == 'SE' &&
                                            dtld40.serial_number !== ''
                                        ) {
                                            lineObj.SERIAL.push(dtld40.serial_number);
                                        }
                                    });
                                }

                                if (dtld_10.DTLD42) {
                                    dtld_10.DTLD42.forEach(function (dtld42) {
                                        if (dtld42.ship_trace_number !== '') {
                                            lineObj.TRACKING.push(dtld42.ship_trace_number);
                                        }
                                    });
                                }

                                if (lineObj.PRICE === 0) return;

                                // check if the ITEMNO, PRICE already exists in invoiceLines
                                var existingLine = vc2_util.findMatching({
                                    list: invoiceLines,
                                    filter: {
                                        ITEMNO: lineObj.ITEMNO,
                                        PRICE: lineObj.PRICE
                                    }
                                });

                                // invoiceLines.find(function (line) {
                                //     return (
                                //         line.ITEMNO === lineObj.ITEMNO &&
                                //         line.PRICE === lineObj.PRICE
                                //     );
                                // });

                                if (!existingLine) {
                                    invoiceLines.push(lineObj);
                                } else {
                                    existingLine.QUANTITY += lineObj.QUANTITY;
                                    existingLine.SERIAL = existingLine.SERIAL.concat(
                                        lineObj.SERIAL
                                    );
                                    existingLine.TRACKING = existingLine.TRACKING.concat(
                                        lineObj.TRACKING
                                    );
                                    if (lineObj.CARRIER !== '') {
                                        existingLine.CARRIER = lineObj.CARRIER;
                                    }
                                }
                            });

                            return invoiceLines;
                        })(txnObj.DTLD10)
                    };

                    returnArr.push({
                        ordObj: orderObj,
                        xmlStr: JSON.stringify(txnObj)
                    });
                });

                returnValue = returnArr;
            } catch (error) {
                vc2_util.logError(logTitle, error);
                throw error;
            }

            return returnValue;
        }
    };
});
