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
 * Script Name: CTC VC | Bill Creator Dashboard Portlet
 * Script ID: customscript_ctc_vc_portlet_bc_dashboard
 * @author brianf@nscatalyst.com
 * @description Portlet script that hosts the Bill Creator dashboard iframe.
 */
function dashboard(portlet) {
    portlet.setTitle('Bill Creator - Dashboard');
    var content =
        '<iframe src="/app/site/hosting/scriptlet.nl?script=customscriptctc_vc_bill_creator_db&deploy=customdeploy_ctc_vc_dashboard" width="100%" height="820" style="margin:0px; border:0px; padding:0px"></iframe>';
    portlet.setHtml(content);
}
