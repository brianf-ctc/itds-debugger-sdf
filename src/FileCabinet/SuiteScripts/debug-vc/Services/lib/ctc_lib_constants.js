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
 * Script Name: ctc_lib_constants.js
 *
 * @author brianf@nscatalyst.com
 * @description Central constants and configuration values for VAR Connect 2.x (legacy/bridge for migration).
 *
 * CHANGELOGS
 * Date         Author        Remarks
 * 2026-03-27   brianf        Renamed MISSING_SALESORDER to STANDALONE_PO; added INSUFFICIENT_USAGE error constant
 * 2026-02-04   brianf        Added unit test results folder constant and script params
 * 2026-01-29   brianf        Added accurate PARAMS for all MR scripts in SCRIPTS object; restructured ERROR_MSG format; formatted header
 *
 * @NApiVersion 2.x
 * @NModuleScope Public
 */
define(function (require) {
    var ns_runtime = require('N/runtime');
    // Note: For variable type testing, use util.isObject, util.isArray, util.isString directly (available at runtime)

    var IS_DEBUG_MODE = false; // Set to true for debugging

    var CTC_CONSTANT = {
        IS_DEBUG_MODE: IS_DEBUG_MODE,
        LOG_APPLICATION: 'ITDS',
        APPNAME: {
            ORDER_STATUS: 'ITDS | Order Status',
            BILL_CREATE: 'ITDS | Bill Create',
            SEND_PO: 'ITDS | Send PO'
        },
        GLOBAL: {
            ENABLE_SUBSIDIARIES: ns_runtime.isFeatureInEffect({ feature: 'subsidiaries' }),
            PICK_PACK_SHIP: ns_runtime.isFeatureInEffect({ feature: 'pickpackship' }),
            LOCATIONS: ns_runtime.isFeatureInEffect({ feature: 'locations' }),
            DATE_FORMAT: 'MM/DD/YYYY',
            COUNTRY: ns_runtime.country,
            SN_LINE_FIELD_LINK_ID: 'custcol_ctc_xml_serial_num_link',
            ITEM_ID_LOOKUP_COL: 'item',
            ITEM_FUL_ID_LOOKUP_COL: 'itemname',
            VENDOR_SKU_LOOKUP_COL: 'item',
            SN_FOLDER_ID: 7,
            UNITTEST_RESULTS_FOLDER_ID: 0,
            EMAIL_TEMPLATE_ID: 220,
            POHANDLING: 'Drop',
            EMAIL_LIST_FIELD_ID: 'custbody_ctc_email_shipping_info_1',
            INCLUDE_ITEM_MAPPING_LOOKUP_KEY: 'ctc_includeItemMapping'
        },
        CACHE_NAME: [
            'VC_CACHE_KEY',
            IS_DEBUG_MODE ? new Date().getTime() : null,
            '20260206.0345' // YYYYMMDD
        ].join('_'),
        CACHE_KEY: {
            LICENSE: 'VC_LICENSE',
            MAIN_CONFIG: 'VC_MAIN_CONFIG',
            VENDOR_CONFIG: 'VC_VENDOR_CONFIG',
            BILLCREATE_CONFIG: 'VC_BILLCREATE_CONFIG',
            SENDPOVND_CONFIG: 'VC_SENDPOVND_CONFIG',
            PO_DATA: 'VC_PODATA'
        }
    };

    CTC_CONSTANT.LICENSE = {
        URL: 'https://nscatalystserver.azurewebsites.net/productauth.php',
        PRODUCT_CODE: 2,
        MAX_RETRY: 3,
        KEY: ['LICENSE', CTC_CONSTANT.CACHE_NAME].join('_'),
        CACHE_NAME: CTC_CONSTANT.CACHE_NAME,
        CACHE_TTL: 86400 // 24 hrs
    };

    CTC_CONSTANT.RECORD = {
        MAIN_CONFIG: {
            ID: 'customrecord_ctc_vc_main_config',
            FIELD: {
                ID: 'internalid',
                NAME: 'name',
                SCHEDULED_FULFILLMENT_TEMPLATE: 'custrecord_ctc_vc_sch_if_email_template',
                SCHEDULED_FULFILLMENT_SENDER: 'custrecord_ctc_vc_sch_if_email_sender',
                SCHEDULED_FULFILLMENT_SEARCH: 'custrecord_ctc_vc_sch_if_search',
                SERIAL_NO_FOLDER_ID: 'custrecord_ctc_vc_serial_folder_id',
                PROCESS_DROPSHIPS: 'custrecord_ctc_vc_process_dropship',
                PROCESS_SPECIAL_ORDERS: 'custrecord_ctc_vc_process_special_order',
                CREATE_ITEM_FULFILLMENTS: 'custrecord_ctc_vc_ds_create_if',
                CREATE_ITEM_RECEIPTS: 'custrecord_ctc_vc_specord_create_ir',
                IGNORE_DIRECT_SHIPS_DROPSHIPS: 'custrecord_ctc_vc_ds_ignore_direct_ship',
                IGNORE_DIRECT_SHIPS_SPECIAL_ORDERS: 'custrecord_ctc_vc_spo_ignore_direct_ship',
                CREATE_SERIAL_DROPSHIPS: 'custrecord_ctc_vc_ds_create_serial',
                CREATE_SERIAL_SPECIAL_ORDERS: 'custrecord_ctc_vc_spo_create_serial',
                USE_INB_TRACKING_SPECIAL_ORDERS: 'custrecord_ctc_vc_specord_inb_track_num',
                LICENSE: 'custrecord_ctc_vc_license',
                LICENSE_TEXT: 'custrecord_ctc_vc_license_text',
                COPY_SERIALS_INV: 'custrecord_ctc_vc_copy_serials_inv',
                SERIAL_SCAN_UPDATE: 'custrecord_ctc_vc_serial_scan_update',
                PRINT_SERIALS_TEMPLATE: 'custrecord_ctc_vc_print_serial_template',
                INV_PRINT_SERIALS: 'custrecord_ctc_vc_print_serials',
                MULTIPLE_INGRAM: 'custrecord_ctc_vc_multiple_ingram',
                INGRAM_HASH_TO_SPACE: 'custrecord_ctc_vc_ingram_hash_to_space',
                FULFILMENT_SEARCH: 'custrecord_ctc_vc_sch_if_search',
                DEFAULT_BILL_FORM: 'custrecord_ctc_vc_bill_form',
                DEFAULT_VENDOR_BILL_STATUS: 'custrecord_ctc_vc_bill_status',
                ALLOWED_VARIANCE_AMOUNT_THRESHOLD: 'custrecord_ctc_vc_bill_var_threshold',
                ALLOW_ADJUSTLINE: 'custrecord_ctc_vc_bill_var_allow_adjline',
                VARIANCE_ON_TAX: 'custrecord_ctc_vc_bill_tax_var',
                DEFAULT_TAX_ITEM: 'custrecord_ctc_vc_bill_tax_item',
                DEFAULT_TAX_ITEM2: 'custrecord_ctc_vc_bill_tax_item2',
                VARIANCE_ON_SHIPPING: 'custrecord_ctc_vc_bill_ship_var',
                DEFAULT_SHIPPING_ITEM: 'custrecord_ctc_vc_bill_ship_item',
                VARIANCE_ON_OTHER: 'custrecord_ctc_vc_bill_other_var',
                DEFAULT_OTHER_ITEM: 'custrecord_ctc_vc_bill_other_item',
                DISABLE_VENDOR_BILL_CREATION: 'custrecord_ctc_vc_bill_is_disabled',
                OVERRIDE_PO_NUM: 'custrecord_ctc_vc_override_po_num',
                AUTOPROC_PRICEVAR: 'custrecord_ctc_vcbc_autopr_pricevar',
                AUTOPROC_TAXVAR: 'custrecord_ctc_vcbc_autopr_taxvar',
                AUTOPROC_SHIPVAR: 'custrecord_ctc_vcbc_autopr_shipvar',
                AUTOPROC_OTHERVAR: 'custrecord_ctc_vcbc_autopr_othervar',
                CUSTOM_ITEM_COLUMN_TO_MATCH: 'custrecord_ctc_vc_cust_item_match_col_id',
                CUSTOM_ITEM_FIELD_TO_MATCH: 'custrecord_ctc_vc_cust_item_match_fld_id',
                MATCH_CUSTOM_ITEM_TO_NAME: 'custrecord_ctc_vc_cust_item_match_strict',
                CUSTOM_MPN_COL_TO_MATCH: 'custrecord_ctc_vc_cust_mpn_match_col_id',
                CUSTOM_MPN_FLD_TO_MATCH: 'custrecord_ctc_vc_cust_mpn_match_fld_id',
                MATCH_CUSTOM_MPN_TO_NAME: 'custrecord_ctc_vc_cust_mpn_match_is_lax',
                AUTOFULFILL_ZEROAMT_LINES: 'custrecord_ctc_vc_autoff_zeroamt_lines',
                ALLOW_NONFF_ITEMS: 'custrecord_ctc_vc_allow_nonff_items'
            }
        },
        VENDOR_CONFIG: {
            ID: 'customrecord_ctc_vc_vendor_config',
            FIELD: {
                ID: 'internalid',
                NAME: 'name',
                SUBSIDIARY: 'custrecord_ctc_vc_vendor_subsidiary',
                XML_VENDOR: 'custrecord_ctc_vc_xml_vendor',
                VENDOR: 'custrecord_ctc_vc_vendor',
                WEBSERVICE_ENDPOINT: 'custrecord_ctc_vc_endpoint',
                START_DATE: 'custrecord_ctc_vc_vendor_start',
                USERNAME: 'custrecord_ctc_vc_user',
                PASSWORD: 'custrecord_ctc_vc_password',
                CUSTOMER_NO: 'custrecord_ctc_vc_customer_number',
                PROCESS_DROPSHIPS: 'custrecord_ctc_vc_process_dropship_vend',
                PROCESS_SPECIAL_ORDERS: 'custrecord_ctc_vc_process_spec_ord_vend',
                FULFILLMENT_PREFIX: 'custrecord_ctc_vc_prefix',
                ACCESS_ENDPOINT: 'custrecord_ctc_vc_access_endpoint',
                API_KEY: 'custrecord_ctc_vc_api_key',
                API_SECRET: 'custrecord_ctc_vc_api_secret',
                OATH_SCOPE: 'custrecord_ctc_vc_oath_scope',
                SUBSCRIPTION_KEY: 'custrecord_ctc_vc_subscription_key',
                USE_SHIPDATE: 'custrecord_ctc_vc_use_shipdate',
                USE_DELIVDATE: 'custrecord_ctc_vc_use_delivdate',
                CUSTOM_ITEM_COLUMN_TO_MATCH: 'custrecord_ctc_vc_item_match_col',
                CUSTOM_ITEM_FIELD_TO_MATCH: 'custrecord_ctc_vc_item_match_fld',
                MATCH_CUSTOM_ITEM_TO_NAME: 'custrecord_ctc_vc_item_match_strict',
                CUSTOM_MPN_COL_TO_MATCH: 'custrecord_ctc_vc_mpn_match_col_id',
                CUSTOM_MPN_FLD_TO_MATCH: 'custrecord_ctc_vc_mpn_match_fld_id',
                MATCH_CUSTOM_MPN_TO_NAME: 'custrecord_ctc_vc_mpn_match_is_lax',
                USE_FULFILL_DATE: 'custrecord_ctc_vc_setitemff_date'
            }
        },
        VC_LOG: {
            ID: 'customrecord_ctc_vcsp_log',
            FIELD: {
                ID: 'internalid',
                APPLICATION: 'custrecord_ctc_vcsp_log_app',
                HEADER: 'custrecord_ctc_vcsp_log_header',
                BODY: 'custrecord_ctc_vcsp_log_body',
                TRANSACTION: 'custrecord_ctc_vcsp_log_transaction',
                TRANSACTION_LINEKEY: 'custrecord_ctc_vcsp_log_linekey',
                STATUS: 'custrecord_ctc_vcsp_log_status',
                DATE: 'custrecord_ctc_vcsp_log_date',
                BATCH: 'custrecord_ctc_vcsp_log_batch'
            }
        },
        VC_LOG_BATCH: {
            ID: 'customrecord_ctc_vcsp_log_batch',
            FIELD: {
                ID: 'internalid',
                TRANSACTION: 'custrecord_ctc_vcsp_log_batch_txn'
            }
        },
        SERIALS: {
            ID: 'customrecordserialnum',
            FIELD: {
                ID: 'internalid',
                NAME: 'name',
                ITEM: 'custrecordserialitem',
                CUSTOMER: 'custrecordcustomer',
                PURCHASE_ORDER: 'custrecordserialpurchase',
                SALES_ORDER: 'custrecordserialsales',
                ITEM_RECEIPT: 'custrecorditemreceipt',
                ITEM_FULFILLMENT: 'custrecorditemfulfillment',
                INVOICE: 'custrecordserialinvoice',
                SO_LINE: 'custrecord_ctc_vc_so_line',
                PO_LINE: 'custrecord_ctc_vc_po_line',
                IF_LINE: 'custrecord_ctc_vc_if_line',
                IR_LINE: 'custrecord_ctc_vc_ir_line',
                INV_LINE: 'custrecord_ctc_vc_inv_line'
            }
        },
        BILLCREATE_CONFIG: {
            ID: 'customrecord_vc_bill_vendor_config',
            FIELD: {
                ID: 'internalid',
                NAME: 'name',
                ENTRY_FUNC: 'custrecord_vc_bc_entry',
                ACK_FUNC: 'custrecord_vc_bc_ack',
                USER: 'custrecord_vc_bc_user',
                PASSWORD: 'custrecord_vc_bc_pass',
                PARTNERID: 'custrecord_vc_bc_partner',
                CONNECTION_TYPE: 'custrecord_vc_bc_connect_type',
                SFTP_HOSTKEY: 'custrecord_vc_bc_host_key',
                URL: 'custrecord_vc_bc_url',
                SUBSIDIARY: 'custrecord_vc_bc_subsidiary',
                SFTP_RESOURCE_PATH: 'custrecord_vc_bc_res_path',
                SFTP_ACK_PATH: 'custrecord_vc_bc_ack_path',
                ENABLE_FULFILLLMENT: 'custrecord_vc_bc_enable_fulfillment',
                SCOPE: 'custrecord_vc_bc_scope',
                SUBSCRIPTION_KEY: 'custrecord_vc_bc_subs_key',
                TOKEN_URL: 'custrecord_vc_bc_token_url',
                IGNORE_TAXVAR: 'custrecord_vc_bc_ignore_taxvar',
                USE_FULFILL_DATE: 'custrecord_vc_bc_use_ffdate'
            }
        },
        BILLFILE: {
            ID: 'customrecord_ctc_vc_bills',
            FIELD: {
                ID: 'id',
                NAME: 'name',
                POID: 'custrecord_ctc_vc_bill_po',
                PO_LINK: 'custrecord_ctc_vc_bill_linked_po',
                BILL_NUM: 'custrecord_ctc_vc_bill_number',
                BILL_LINK: 'custrecord_ctc_vc_bill_linked_bill',
                DATE: 'custrecord_ctc_vc_bill_date',
                DUEDATE: 'custrecord_ctc_vc_bill_due_date',
                DDATE_INFILE: 'custrecord_ctc_vc_bill_due_date_f_file',
                STATUS: 'custrecord_ctc_vc_bill_proc_status',
                PROCESS_LOG: 'custrecord_ctc_vc_bill_log',
                INTEGRATION: 'custrecord_ctc_vc_bill_integration',
                SOURCE: 'custrecord_ctc_vc_bill_src',
                JSON: 'custrecord_ctc_vc_bill_json',
                NOTES: 'custrecord_ctc_vc_bill_notes',
                HOLD_REASON: 'custrecord_ctc_vc_bill_hold_rsn',
                IS_RCVBLE: 'custrecord_ctc_vc_bill_is_recievable',
                PROC_VARIANCE: 'custrecord_ctc_vc_bill_proc_variance',
                FILEPOS: 'custrecord_ctc_vc_bill_file_position',
                VARAMT: 'custrecord_ctc_vc_bill_calc_variance'
            }
        },
        SENDPO_CONFIG: { ID: 'customrecord_ctc_vcsp_vendor_config' },
        SENDPOVENDOR_CONFIG: {
            ID: 'customrecord_ctc_vcsp_vendor_config',
            FIELD: {
                ID: 'internalid',
                NAME: 'name',
                SUBSIDIARY: 'custrecord_ctc_vcsp_vendor_subsidiary',
                XML_VENDOR: 'custrecord_ctc_vcsp_api_vendor',
                VENDOR: 'custrecord_ctc_vcsp_vendor',
                EVENT_TYPE: 'custrecord_ctc_vcsp_event',
                TEST_REQUEST: 'custrecord_ctc_vcsp_test',
                IS_SPECIAL_ITEM_NAME: 'custrecord_vcsp_is_item_name_special',
                WEBSERVICE_ENDPOINT: 'custrecord_ctc_vcsp_endpoint',
                ACCESS_ENDPOINT: 'custrecord_ctc_vcsp_access_endpoint',
                OAUTH_SCOPE: 'custrecord_ctc_vcsp_access_scope',
                SUBSCRIPTION_KEY: 'custrecord_ctc_vcsp_access_subscr_key',
                USERNAME: 'custrecord_ctc_vcsp_username',
                PASSWORD: 'custrecord_ctc_vcsp_password',
                CUSTOMER_NO: 'custrecord_ctc_vcsp_customer_number',
                API_KEY: 'custrecord_ctc_vcsp_api_key',
                API_SECRET: 'custrecord_ctc_vcsp_api_secret',
                FIELD_MAP: 'custrecord_ctc_vcsp_fieldmapping',
                QA_WEBSERVICE_ENDPOINT: 'custrecord_ctc_vcsp_endpoint_qa',
                QA_ACCESS_ENDPOINT: 'custrecord_ctc_vcsp_access_endpoint_qa',
                QA_OAUTH_SCOPE: 'custrecord_ctc_vcsp_access_scope_qa',
                QA_API_KEY: 'custrecord_ctc_vcsp_api_key_qa',
                QA_API_SECRET: 'custrecord_ctc_vcsp_api_secret_qa',
                QA_SUBSCRIPTION_KEY: 'custrecord_ctc_vcsp_access_subscr_qa',
                PONUM_FIELD: 'custrecord_ctc_vcsp_ponum_field',
                ITEM_COLUMN: 'custrecord_ctc_vcsp_item_field',
                QUOTE_COLUMN: 'custrecord_ctc_vcsp_quoteno_field',
                MEMO_FIELD: 'custrecord_ctc_vcsp_memo_field',
                SHIP_CONTACT_FIELD: 'custrecord_ctc_vcsp_shipcontact_field',
                SHIP_EMAIL_FIELD: 'custrecord_ctc_vcsp_shipemail_field',
                SHIP_PHONE_FIELD: 'custrecord_ctc_vcsp_shipphone_field',
                ENABLE_ADD_VENDOR_DETAILS: 'custrecord_ctc_vcsp_show_details',
                ADDITIONAL_PO_FIELDS: 'custrecord_ctc_vcsp_po_fields',
                ADD_DETAILS_ON_SUBMIT: 'custrecord_ctc_vcsp_auto_include_details',
                PO_LINE_COLUMNS: 'custrecord_ctc_vcsp_line_cols',
                BILL_ID: 'custrecord_ctc_vcsp_bill_addrid',
                BILL_ADDRESSEE: 'custrecord_ctc_vcsp_bill_addressee',
                BILL_ATTENTION: 'custrecord_ctc_vcsp_bill_attention',
                BILL_EMAIL: 'custrecord_ctc_vcsp_bill_email',
                BILL_PHONENO: 'custrecord_ctc_vcsp_phoneno',
                BILL_ADDRESS_1: 'custrecord_ctc_vcsp_bill_addr1',
                BILL_ADDRESS_2: 'custrecord_ctc_vcsp_bill_addr2',
                BILL_CITY: 'custrecord_ctc_vcsp_bill_city',
                BILL_STATE: 'custrecord_ctc_vcsp_bill_state',
                BILL_ZIP: 'custrecord_ctc_vcsp_bill_zip',
                BILL_COUNTRY: 'custrecord_ctc_vcsp_bill_country',
                PAYMENT_MEAN: 'custrecord_ctc_vcsp_payment_mean',
                PAYMENT_OTHER: 'custrecord_ctc_vcsp_payment_mean_other',
                PAYMENT_TERM: 'custrecord_ctc_vcsp_payment_term',
                BUSINESS_UNIT: 'custrecord_ctc_vcsp_businessunit'
            }
        },
        VENDOR_ITEM_MAPPING: {
            ID: 'customrecord_ctc_vc_item_mapping',
            FIELD: {
                NAME: 'name',
                ITEM: 'custrecord_ctc_vc_itemmap_item'
            }
        },
        ORDER_LINE: {
            ID: 'customrecord_ctc_vc_orderlines',
            FIELD: {
                ORDNUM_LINK: 'custrecord_ctc_vc_orderline_ordernum',
                RECKEY: 'custrecord_ctc_vc_orderline_reckey',
                VENDOR: 'custrecord_ctc_vc_orderline_vendor',
                TXN_LINK: 'custrecord_ctc_vc_orderline_txnlink',
                ORDER_NUM: 'custrecord_ctc_vc_orderline_vndordernum',
                ORDER_STATUS: 'custrecord_ctc_vc_orderline_vndorderstat',
                STATUS: 'custrecord_ctc_vc_orderline_orderstatus',
                LINE_STATUS: 'custrecord_ctc_vc_orderline_linestatus',
                ITEM: 'custrecord_ctc_vc_orderline_itemname',
                SKU: 'custrecord_ctc_vc_orderline_vendorsku',
                LINE_NO: 'custrecord_ctc_vc_orderline_vndlineno',
                VNDLINE: 'custrecord_ctc_vc_orderline_vendorlineno',
                ITEM_LINK: 'custrecord_ctc_vc_orderline_itemlink',
                ORDER_TYPE: 'custrecord_ctc_vc_orderline_ordertype',
                MAIN_ITEM: 'custrecord_ctc_vc_orderline_main_item',
                POLINE_UNIQKEY: 'custrecord_ctc_vc_orderline_polinekey',
                QTY: 'custrecord_ctc_vc_orderline_vndqty',
                PO_QTY: 'custrecord_ctc_vc_orderline_poqty',
                PO_RATE: 'custrecord_ctc_vc_orderline_porate',
                VND_RATE: 'custrecord_ctc_vc_orderline_vndrate',
                ORDER_DATE: 'custrecord_ctc_vc_orderline_orderdate',
                // ORDER_DATETXT: 'custrecord_ctc_vc_orderline_vndorderdate',
                SHIPPED_DATE: 'custrecord_ctc_vc_orderline_shippeddate',
                ETA_DATE: 'custrecord_ctc_vc_orderline_eta_date',
                ETD_DATE: 'custrecord_ctc_vc_orderline_etd_date',
                PROMISED_DATE: 'custrecord_ctc_vc_orderline_promiseddate',
                CARRIER: 'custrecord_ctc_vc_orderline_carrier',
                SHIP_METHOD: 'custrecord_ctc_vc_orderline_shipmethod',
                TRACKING: 'custrecord_ctc_vc_orderline_trackingno',
                SERIALNUM: 'custrecord_ctc_vc_orderline_serialno',
                ORDER_DATA: 'custrecord_ctc_vc_orderline_vndorderdata',
                LINE_DATA: 'custrecord_ctc_vc_orderline_vndlinedata',
                ITEMFF_LINK: 'custrecord_ctc_vc_orderline_itemfflink',
                VB_LINK: 'custrecord_ctc_vc_orderline_vblink',
                BILLFILE_LINK: 'custrecord_ctc_vc_orderline_billfile',
                SHIP_STATUS: 'custrecord_ctc_vc_orderline_shipstatus',
                SUBSCRIPTION_ID: 'custrecord_ctc_vc_orderline_subscriptid',
                SERVICE_START_DATE: 'custrecord_ctc_vc_orderline_servstartdt',
                ETA_SERV_START_DATE: 'custrecord_ctc_vc_orderline_estservstart',
                START_DATE: 'custrecord_ctc_vc_orderline_startdate',
                END_DATE: 'custrecord_ctc_vc_orderline_enddate',
                TERM: 'custrecord_ctc_vc_orderline_term',
                RENEWAL_TERM: 'custrecord_ctc_vc_orderline_renewalterm',
                BILLING_MODEL: 'custrecord_ctc_vc_orderline_billingmodel'

            }
        },
        ORDER_NUM: {
            ID: 'customrecord_ctc_vc_ordernums',
            FIELD: {
                TXN_LINK: 'custrecord_ctc_vc_ordernum_txnlink',
                ORDER_NUM: 'custrecord_ctc_vc_ordernum_ponum',
                VENDOR_NUM: 'custrecord_ctc_vc_ordernum_vendorpo',
                ORDER_STATUS: 'custrecord_ctc_vc_ordernum_status',
                ORDER_DATE: 'custrecord_ctc_vc_ordernum_orderdate',
                SHIPPED_DATE: 'custrecord_ctc_vc_ordernum_shipdate',
                DELIV_DATE: 'custrecord_ctc_vc_ordernum_delivdate',
                ETA_DATE: 'custrecord_ctc_vc_ordernum_eta',
                DELIV_ETA: 'custrecord_ctc_vc_ordernum_deliv_eta',
                TOTAL: 'custrecord_ctc_vc_ordernum_total',
                ITEMFF_LINK: 'custrecord_ctc_vc_ordernum_itemff',
                SOURCE: 'custrecord_ctc_vc_ordernum_sourcedata',
                LINES: 'custrecord_ctc_vc_ordernum_vendorlines',
                VENDOR: 'custrecord_ctc_vc_ordernum_vendor',
                VENDOR_CFG: 'custrecord_ctc_vc_ordernum_config',
                NOTE: 'custrecord_ctc_vc_ordernum_procnote',
                DETAILS: 'custrecord_ctc_vc_ordernum_procdetails',
                QUOTE: 'custrecord_ctc_vc_ordernum_quote'
            }
        },
        VAR_CONNECT_PO_LINE: {
            ID: 'customrecord_ctc_vc_poline',
            FIELD: {
                PURCHASE_ORDER: 'custrecord_ctc_vc_poline_po',
                LINE_UNIQUE_KEY: 'custrecord_ctc_vc_poline_lineuniquekey',
                LINE: 'custrecord_ctc_vc_poline_line',
                VENDOR_LINE: 'custrecord_ctc_vc_poline_vendorline',
                STATUS: 'custrecord_ctc_vc_poline_status',
                TYPE: 'custrecord_ctc_vc_poline_type',
                VENDOR_ORDER_NUMBER: 'custrecord_ctc_vc_poline_vendorordernum',
                CUSTOMER_ORDER_NUMBER: 'custrecord_ctc_vc_poline_customerordnum',
                ORDER_DATE: 'custrecord_ctc_vc_poline_orderdate',
                SKU: 'custrecord_ctc_vc_poline_itemname',
                MPN: 'custrecord_ctc_vc_poline_mpn',
                NOTE: 'custrecord_ctc_vc_poline_note',
                QUANTITY: 'custrecord_ctc_vc_poline_quantity',
                RATE: 'custrecord_ctc_vc_poline_rate',
                SHIP_DATE: 'custrecord_ctc_vc_poline_shipdate',
                QTY_SHIPPED: 'custrecord_ctc_vc_poline_qtyshipped',
                SHIP_FROM: 'custrecord_ctc_vc_poline_shipfrom',
                SHIP_METHOD: 'custrecord_ctc_vc_poline_shipmethod',
                CARRIER: 'custrecord_ctc_vc_poline_carrier',
                ETA_DATE: 'custrecord_ctc_vc_poline_etadate',
                SERIAL_NUMBERS: 'custrecord_ctc_vc_poline_serialnumbers',
                TRACKING_NUMBERS: 'custrecord_ctc_vc_poline_trackingnumber',
                INTERNAL_REFERENCE: 'custrecord_ctc_vc_poline_internalref',
                JSON_DATA: 'custrecord_ctc_vc_poline_full_response',
                CREATE_LOG: 'custrecord_ctc_vc_poline_vccreatelog',
                UPDATE_LOG: 'custrecord_ctc_vc_poline_vcupdatelog'
            }
        }
    };

    CTC_CONSTANT.LIST = {
        XML_VENDOR: {
            TECH_DATA: '1',
            INGRAM_MICRO: '2',
            SYNNEX: '3',
            DandH: '4',
            AVNET: '5',
            WESTCON: '6',
            ARROW: '7',
            DELL: '8',
            SYNNEX_API: '9',
            INGRAM_MICRO_API: '10',
            INGRAM_MICRO_V_ONE: '11',
            TECH_DATA_API: '12',
            JENNE: '13',
            SCANSOURCE: '14',
            WEFI: '16',
            DandH_API: '17',
            CARAHSOFT: '19',
            CISCO: '21'
        },
        VC_LOG_STATUS: {
            SUCCESS: '1',
            ERROR: '2',
            INFO: '3',
            WARN: '4',
            RECORD_ERROR: '5',
            API_ERROR: '6',
            SFTP_ERROR: '7',
            CONFIG_ERROR: '8',
            WS_ERROR: '9'
        },
        COUNTRY: {
            US: '1',
            CANADA: '2'
        },
        ORDER_STATUS: {
            PENDING: 1,
            SHIPPED: 2,
            INVOICED: 3,
            PARTIALLY_SHIPPED: 4,
            PARTIALLY_BILED: 5,
            BACKORDERED: 6,
            DELETED: 7,
            NOT_FOUND: 8,
            ON_HOLD: 9,
            IN_PROGRESS: 10,
            SCHEDULED: 11,
            CLOSED: 12,
            OPEN_ORDER: 13
        },
        FULFILL_DATE: {
            TODAY: '1',
            SHIP_DATE: '2',
            DELIV_DATE: '3'
        }
    };

    CTC_CONSTANT.SCRIPT = {
        ORDERSTATUS_MR: {
            SCRIPT_ID: 'customscript_ctc_script_xml_v2',
            DEPLOY_ID: 'customdeploy_ctc_script_xml_v2',
            PARAMS: {
                searchId: 'custscript_orderstatus_searchid',
                vendorId: 'custscript_orderstatus_vendorid',
                internalid: 'custscript_orderstatus_orderid',
                use_fulfill_rl: 'custscript_orderstatus_restletif'
            }
        },
        BILLPROCESS_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_process_bills',
            DEPLOY_ID: null,
            PARAMS: {}
        },
        VIEW_SERIALS_SL: {
            SCRIPT_ID: 'customscript_vc_view_serials',
            DEPLOY_ID: 'customdeploy_vc_view_serials',
            PARAMS: {}
        },
        LICENSE_VALIDATOR_SL: {
            SCRIPT_ID: 'customscript_ctc_vc_sl_licensevalidator',
            DEPLOY_ID: 'customdeploy_ctc_vc_sl_licensevalidator',
            PARAMS: {}
        },
        PRINT_SERIALS_SL: {
            SCRIPT_ID: 'customscript_ctc_vc_sl_print_serial',
            DEPLOY_ID: 'customdeploy_ctc_vc_sl_print_serial',
            PARAMS: {}
        },
        SERIAL_UPDATE_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_mr_serial_manip',
            DEPLOY_ID: null,
            PARAMS: {
                recordType: 'custscript_vc_type',
                recordId: 'custscript_vc_id'
            }
        },
        SERIAL_UPDATE_ALL_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_mr_serial_manip_so',
            DEPLOY_ID: null,
            PARAMS: {
                recordType: 'custscript_vc_all_type',
                recordId: 'custscript_vc_all_id'
            }
        },
        ITEM_MATCH_RL: {
            SCRIPT_ID: 'customscript_ctc_vc_fuse_itemmatch',
            DEPLOY_ID: 'customdeploy_ctc_vc_fuse_itemmatch',
            PARAMS: {}
        },
        UNITTEST_RUNNER_SS: {
            SCRIPT_ID: 'customscript_ctc_vc_unittest_runner',
            DEPLOY_ID: null,
            PARAMS: {
                testList: 'custscript_ctc_ut_testlist',
                filter: 'custscript_ctc_ut_filter',
                writeFile: 'custscript_ctc_ut_writefile',
                fileName: 'custscript_ctc_ut_filename'
            }
        },
        SERVICES_RL: {
            SCRIPT_ID: 'customscript_ctc_vc_rl_services',
            DEPLOY_ID: 'customdeploy_ctc_rl_services',
            PARAMS: {}
        },
        GETBILLS_API: {
            SCRIPT_ID: 'customscript_ctc_vc_retrieve_api_file',
            DEPLOY_ID: null,
            PARAMS: {}
        },
        ADD_SERIALS_MR: {
            SCRIPT_ID: 'customscript_add_serials_mr',
            DEPLOY_ID: null,
            PARAMS: {
                fileId: 'custscript_serialsFileId'
            }
        },
        SERIALIZATION_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_mr_serialization',
            DEPLOY_ID: null,
            PARAMS: {
                searchId: 'custscript_ctc_vc_mr_serialization_srch'
            }
        },
        DANDH_ITEMREQUEST_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_mr_dhitemrequest',
            DEPLOY_ID: null,
            PARAMS: {
                searchId: 'custscript_ctc_vc_dh_itemrequest_srch'
            }
        },
        AUTO_FULFILL_LINES_MR: {
            SCRIPT_ID: 'customscript_ctc_vc_mr_auto_fulfill_line',
            DEPLOY_ID: null,
            PARAMS: {
                searchId: 'custscript_ctc_autofulfill_searchid'
            }
        }
    };

    CTC_CONSTANT.FIELD = {
        ITEM: {
            DH_MPN: 'custitem_ctc_vc_dh_item'
        },
        TRANSACTION: {
            BYPASS_PO: 'custbody_ctc_bypass_vc',
            OVERRIDE_PONUM: 'custbody_ctc_vc_override_ponum',
            SEND_SHIPPING_UPDATE_TO: 'custbody_ctc_vc_email_shipping_info',
            FORCE_RUN_ORDER_STATUS: 'custbody_ctc_force_run_order_status',

            INBOUND_TRACKING_NUM: 'custcol_ctc_xml_inb_tracking_num',
            SERIAL_NUMBER_SCAN: 'custcol_ctc_serial_number_scan',
            SERIAL_NUMBER_UPDATE: 'custcol_ctc_serial_number_update',
            DH_MPN: 'custcol_ctc_vc_dh_mpn',
            DELL_QUOTE_NO: 'custcol_ctc_vcsp_quote_no'
        },
        ENTITY: {
            BILLCONFIG: 'custentity_vc_bill_config'
        }
    };

    CTC_CONSTANT.DATE_FIELDS = [
        'order_date',
        'ship_date',
        'order_eta',
        'deliv_eta',
        'deliv_date',
        'prom_date',
        'req_start_date',
        'est_end_date',
        'start_date',
        'end_date'
    ];

    CTC_CONSTANT.VENDOR_LINE_DEF = {
        VENDORLINE_COLS: [
            'ITEM_TEXT',
            'ORDER_NUM',
            'ORDER_STATUS',

            'ORDER_DATE',
            'SHIP_DATE',

            'ORDER_ETA',
            'ORDER_ETA_LIST',
            'DELIV_ETA',

            'DELIV_DATE',
            'ORDER_DELIV',

            'SHIP_METHOD',
            'CARRIER',
            'TRACKING_NUMS',
            'SERIAL_NUMS',
            'APPLIEDRATE',
            'APPLIEDQTY'
        ],
        ORDERLINE_COLS: [
            'custcol_ctc_xml_dist_order_num',
            'custcol_ctc_xml_date_order_placed',
            'custcol_ctc_vc_order_placed_date',

            'custcol_ctc_vc_shipped_date',
            'custcol_ctc_vc_eta_date',
            'custcol_ctc_vc_prom_deliv_date',
            'custcol_ctc_vc_xml_prom_deliv_date',
            'custcol_ctc_vc_delivery_date',

            'custcol_ctc_vc_delivery_eta_date',
            'custcol_ctc_xml_ship_date',
            'custcol_ctc_xml_carrier',
            'custcol_ctc_xml_eta',
            'custcol_ctc_xml_tracking_num',
            'custcol_ctc_xml_inb_tracking_num',
            'custcol_ctc_xml_serial_num',
            'custcol_ctc_vc_vendor_info',
            'custcol_ctc_vc_order_status',
            'custcol_ctc_xml_ship_method'
        ],
        FIELD_DEF: {
            DATE: [
                'custcol_ctc_vc_eta_date',
                'custcol_ctc_vc_order_placed_date',
                'custcol_ctc_vc_shipped_date',
                'custcol_ctc_vc_prom_deliv_date',
                'custcol_ctc_vc_delivery_eta_date',
                'custcol_ctc_vc_delivery_date'
            ],
            TEXT: [
                'custcol_ctc_xml_carrier',
                'custcol_ctc_xml_ship_method',
                'custcol_ctc_xml_date_order_placed',
                'custcol_ctc_xml_ship_date'
            ],
            TEXT_LIST: [
                'custcol_ctc_xml_eta',
                'custcol_ctc_xml_dist_order_num',
                'custcol_ctc_xml_serial_num',
                'custcol_ctc_xml_tracking_num',
                'custcol_ctc_xml_inb_tracking_num'
            ],
            TEXTAREA: [
                'custcol_ctc_vc_vendor_info',
                'custcol_ctc_serial_number_scan',
                'custcol_ctc_serial_number_update',
                'custcol_ctc_vc_order_status'
            ]
        },
        MAPPING: {
            custcol_ctc_xml_dist_order_num: 'ORDER_NUM',

            custcol_ctc_xml_date_order_placed: 'ORDER_DATE',
            custcol_ctc_vc_order_placed_date: 'ORDER_DATE',

            custcol_ctc_vc_eta_date: 'ORDER_ETA',
            custcol_ctc_xml_eta: 'ORDER_ETA',

            custcol_ctc_vc_shipped_date: 'SHIP_DATE',
            custcol_ctc_xml_ship_date: 'SHIP_DATE',

            custcol_ctc_vc_prom_deliv_date: 'DELIV_ETA',
            custcol_ctc_vc_xml_prom_deliv_date: 'DELIV_ETA',
            custcol_ctc_vc_delivery_eta_date: 'DELIV_ETA',

            custcol_ctc_vc_delivery_date: 'DELIV_DATE',

            custcol_ctc_xml_carrier: 'CARRIER',

            custcol_ctc_xml_tracking_num: 'TRACKING_NUMS',
            custcol_ctc_xml_inb_tracking_num: 'TRACKING_NUMS',
            custcol_ctc_xml_serial_num: 'SERIAL_NUMS',
            custcol_ctc_vc_vendor_info: 'INFO',
            custcol_ctc_vc_order_status: 'STATUS',
            custcol_ctc_xml_ship_method: 'SHIP_METHOD',
            custcol_ctc_vc_vendor_info: 'ORDER_INFO'
        }
    };

    // Add RECORD, LIST, FIELD, etc. as needed for migration

    // ERROR_MSG: Merged from CTC_VC2_Constants.js and BillCreator errors
    CTC_CONSTANT.ERROR_MSG = {
        // CONFIG ERRORS
        INVALID_LICENSE: {
            message:
                'License is no longer valid or has expired. Please contact damon@nscatalyst.com to get a new license. Your product has been disabled.',
            logType: 'CONFIG_ERROR',
            level: 'CRITICAL'
        },
        MISSING_CONFIG: {
            message: 'Missing Main Configuration',
            logType: 'CONFIG_ERROR',
            level: 'CRITICAL'
        },
        MISSING_VENDORCFG: {
            message: 'Missing Vendor Configuration',
            logType: 'CONFIG_ERROR',
            level: 'CRITICAL'
        },
        MISSING_PREFIX: {
            message: 'Missing Fulfillment Prefix',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        NO_PROCESS_DROPSHIP_SPECIALORD: {
            message: 'Process DropShips and Process Special Orders is not enabled!',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        MISSING_ORDERSTATUS_SEARCHID: {
            message: 'Missing Search: Open PO for Order Status processing',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        BYPASS_VARCONNECT: {
            message: 'Bypass VAR Connect is checked on this PO',
            logType: 'WARN',
            level: 'WARNING'
        },
        // ORDER STATUS
        LINE_NOT_MATCHED: {
            message: 'Line item not matched',
            logType: 'INFO',
            level: 'WARNING'
        },
        MATCH_NOT_FOUND: {
            message: 'Could not find matching item',
            logType: 'WARN',
            level: 'WARNING',
            similarTo: 'LINE_NOT_MATCHED'
        },
        MISSING_ORDERNUM: {
            message: 'Missing Order Num',
            logType: 'WARN',
            level: 'ERROR'
        },
        // FULFILLMENT
        STANDALONE_PO: {
            message: 'PO is not linked to a Sales Order. Standalone POs are not supported.',
            logType: 'RECORD_ERROR',
            level: 'ERROR'
        },
        FULFILLMENT_NOT_ENABLED: {
            message: 'Item Fulfillment creation is not enabled',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        INSUFFICIENT_SERIALS: {
            message: 'Insufficient Serials quantity',
            logType: 'ERROR',
            level: 'ERROR'
        },
        INSUFFICIENT_USAGE: {
            message: 'Insufficient governance units to complete processing',
            logType: 'ERROR',
            level: 'ERROR'
        },
        ORDER_EXISTS: {
            message: 'Order already exists',
            logType: 'WARN',
            level: 'WARNING'
        },
        TRANSFORM_ERROR: {
            message: 'Transform error',
            logType: 'RECORD_ERROR',
            level: 'ERROR'
        },
        NO_LINES_TO_PROCESS: {
            message: 'No lines to process.',
            logType: 'WARN',
            level: 'WARNING'
        },
        NO_FULFILLABLES: {
            message: 'No fulfillable lines',
            logType: 'INFO',
            level: 'INFO',
            similarTo: 'NO_LINES_TO_PROCESS'
        },
        NO_MATCHINGITEMS_TO_FULFILL: {
            message: 'No matching items to fulfill.',
            logType: 'INFO',
            level: 'INFO',
            similarTo: 'NO_LINES_TO_PROCESS'
        },
        UNABLE_TO_FULFILL: {
            message: 'Unable to fulfill all items',
            logType: 'ERROR',
            level: 'ERROR'
        },
        NO_SHIP_QTY: {
            message: 'No shipped items',
            logType: 'WARN',
            level: 'WARNING'
        },
        NOT_YET_SHIPPED: {
            message: 'Not yet shipped.',
            logType: 'WARN',
            level: 'WARNING',
            similarTo: 'NO_SHIP_QTY'
        },
        NO_ORDERS_TO_FULFILL: {
            message: 'No orders to fulfill.',
            logType: 'WARN',
            level: 'WARNING',
            similarTo: 'NO_LINES_TO_PROCESS'
        },
        PO_FULLYFULFILLED: {
            message: 'PO is fully fulfilled',
            logType: 'WARN',
            level: 'WARNING'
        },
        PO_CLOSED: {
            message: 'PO is closed',
            logType: 'WARN',
            level: 'WARNING',
            similarTo: 'PO_FULLYFULFILLED'
        },
        // ITEM RECEIPT
        ITEMRECEIPT_NOT_ENABLED: {
            message: 'Item Receipt creation is not enabled',
            logType: 'CONFIG_ERROR',
            level: 'ERROR',
            similarTo: 'FULFILLMENT_NOT_ENABLED'
        },
        // VALIDATION ERRORS
        MISSING_PO: {
            message: 'Missing PO',
            logType: 'RECORD_ERROR',
            level: 'CRITICAL'
        },
        INVALID_PO: {
            message: 'Invalid PO',
            logType: 'RECORD_ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_PO'
        },
        MISSING_LINES: {
            message: 'Missing Order Lines',
            logType: 'RECORD_ERROR',
            level: 'ERROR'
        },
        MISSING_VENDOR_LINE: {
            message: 'Missing Vendor Line',
            logType: 'ERROR',
            level: 'ERROR'
        },
        INVALID_PODATE: {
            message: 'Invalid PO Date',
            logType: 'WARN',
            level: 'WARNING'
        },
        // ORDER STATUS ERROR
        INVALID_CREDENTIALS: {
            message: 'Invalid credentials',
            logType: 'CONFIG_ERROR',
            level: 'CRITICAL'
        },
        INVALID_REQUEST: {
            message: 'Invalid request query',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        INVALID_ACCESSPOINT: {
            message: 'Invalid Access Endpoint',
            logType: 'CONFIG_ERROR',
            level: 'ERROR'
        },
        ENDPOINT_URL_ERROR: {
            message: 'Unable to reach the webservice endpoint',
            logType: 'CONFIG_ERROR',
            level: 'ERROR',
            similarTo: 'INVALID_ACCESSPOINT'
        },
        INVALID_ACCESS_TOKEN: {
            message: 'Invalid or expired access token',
            logType: 'ERROR',
            level: 'ERROR'
        },
        ORDER_NOT_FOUND: {
            message: 'Order not found',
            logType: 'ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_PO'
        },
        // BILLFILE ERRORS (standardized)
        BILLFILE_INVALID_ITEM: {
            message: 'Bill File contains invalid item lines.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_INVALID_VARIANCE: {
            message: 'Bill File variance calculation is invalid.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_INVALID_STATUS_TRANSITION: {
            message: 'Invalid status transition for Bill File.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_INVALID_PROCESS: {
            message: 'Bill File cannot be processed due to invalid state.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_MISSING_REQUIRED: {
            message: 'Bill File is missing required fields.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_MISSING_CONFIG: {
            message: 'Bill File is missing required configuration.',
            logType: 'ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_CONFIG'
        },
        BILLFILE_MISSING_BILL: {
            message: 'Bill File is missing linked Vendor Bill.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_INVALID_BILL: {
            message: 'Bill File linked Vendor Bill is invalid.',
            logType: 'ERROR',
            level: 'ERROR'
        },
        BILLFILE_INVALID_VENDOR_CONFIG: {
            message: 'Bill File vendor configuration is invalid.',
            logType: 'ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_VENDORCFG'
        },
        BILLFILE_INVALID_MAIN_CONFIG: {
            message: 'Bill File main configuration is invalid.',
            logType: 'ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_CONFIG'
        },
        BILLFILE_INVALID_BILL_CONFIG: {
            message: 'Bill File bill vendor configuration is invalid.',
            logType: 'ERROR',
            level: 'ERROR',
            similarTo: 'MISSING_VENDORCFG'
        },
        BILLFILE_INVALID_LICENSE: {
            message: 'Bill File license is invalid or expired.',
            logType: 'ERROR',
            level: 'CRITICAL',
            similarTo: 'INVALID_LICENSE'
        }
    };

    return CTC_CONSTANT;
});
