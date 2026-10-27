/* Agoda's guest emails as they arrive, for tests: made-up guest, booking and links, Agoda's layout (October 2026).
   specialHtml / specialText: a special request with the three answer buttons; replyHtml / replyText: a guest's reply
   in Chinese with Agoda's translation and the earlier messages under it. */

const TRACK = 'http://tracking.agoda.com/click?cid=1798843&amp;name=hermes-guest-email&amp;memberID=1&amp;messageId=2&amp;abUser=Z&amp;conversationId=3&amp;messageType=Message &amp;templateName=special_request&amp;propertyId=90000001&amp;redirectUrl=https://www.agoda.com/partners/tracking.aspx?CID%3D1798843&amp;linkType=logo';
export const ANSWER = (n) => 'https://portal.agoda.com/en-us/PropertyMessage/PropertyMessage?hotelId=90000001&token=test.token.abc&requestType=' + n;
const answer = (n) => ANSWER(n).replace(/&/g, '&amp;');

export const specialHtml = `<img width="1" height="1" border="0" src="http://tracking.agoda.com/open?cid=1798843&amp;propertyId=90000001" style="display:none;">
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta content="text/html; charset=utf-8" http-equiv="Content-Type"><style type="text/css">.card{border-radius:8px;}</style></head>
<body>
<div class="outer-container">
<div class="container">
<a class="logo" href="${TRACK}" target="_blank" title="Agoda.com"><img src="https://cdn6.agoda.net/images/hermes/20190724/agoda-logo-hermes-email@2x.png" alt="www.agoda.com" id="agoda-logo"/></a>
<h1 id="notice-header-message">New message from Mei Tan</h1>
<div class="card" id="card">
<div>
<table class="card-header"><tbody><tr>
<td style="width: 0;" id="header-sender-image"><img class="card-icon" src="https://cdn6.agoda.net/images/avatar/Avatars40x40@2x/M.png" alt="property icon"/></td>
<td style="padding: 0 12px;" id="header-sender-name" class="header-sender-name"><strong>Mei Tan</strong>
<span class="hide-in-desktop" id="header-image-subtitle-mobile">Oct 26, 04:28 PM ICT</span></td>
<td style="text-align: end;" id="header-timestamp" class="header-timestamp hide-in-mobile"><span class="card-header-secondary-text">Oct 26, 04:28 PM ICT</span></td>
</tr></tbody></table>
</div>
<hr/>
<div>
<p id="salutation" style="font-weight: 400">Dear Kozi Stays @ Vortex KLCC,</p>
<br/>
Requested: Non-smoking, Large bed, High floor, Quiet room<br>Additional notes: Away from elevator.
<p style="padding-top:8px">
Please confirm below if you agree to the special requests.
</p>
<div style="margin-top: 16px;" id="translated-message">
<div class="tertiary-notice-card"><table><tbody><tr>
<td><img class="icon-BubbleLanguageSymbolFill" src="https://cdn6.agoda.net/images/Hermes/email/BubbleLanguageSymbolFill.png" width="20px" height="20px"></td>
<td><span class="tertiary-notice-card-header">Google translate</span>
<p style="margin: 4px 0 0;">Requested: Non-smoking, Large bed, High floor, Quiet room<br>Additional notes: Away from elevator.</p></td>
</tr></tbody></table></div>
</div>
<div style="margin-top: 20px; margin-bottom: 20px;">
<table><tbody>
<tr><td style="display: block; height: 36px; padding-top: 8px">
<a id="special-request-button-accepted" class="special-request-button accepted" style="margin-top: -10px" href=${answer(2)}>
<img class="icon-circle-check" src="https://cdn6.agoda.net/images/Hermes/email/circle-check.png" width="20" height="20">
<span style="font-size: 14px;"> Accepted
</span>
</a>
<br/></td></tr>
<tr><td style="display: block; height: 36px; padding-top: 8px">
<a id="special-request-button-subject-to-availability" class="special-request-button subject-to-availability" style="margin-top: -10px" href=${answer(1)}>
<img class="icon-circle-exclamation" src="https://cdn6.agoda.net/images/Hermes/email/circle-exclamation.png" width="20" height="20">
<span style="font-size: 14px;"> Subject to availability
</span>
</a>
<br/></td></tr>
<td style="display: block; height: 36px; padding-top: 8px">
<a id="special-request-button-not-approved" class="special-request-button not-approved" style="margin-top: -10px" href=${answer(3)}>
<img class="icon-circle-close" src="https://cdn6.agoda.net/images/Hermes/email/circle-close.png" width="20" height="20">
<span style="font-size: 14px;"> Not accepted
</span>
</a>
<br/></td>
</tbody></table>
</div>
<div style="margin-top: 16px; margin-bottom: 16px; text-align: center">
<a id="replyLink" class="button-link responsive-button " href="http://tracking.agoda.com/click?cid=1798843&amp;linkType=ycs_button&amp;redirectUrl=https://portal.agoda.com/mldc/en-us/app/hermes/inbox/ycs/90000001/?conversation=3" style="color: #FFFFFF;"><span> Reply through YCS
</span></a>
</div>
<div class="secondary-notice-card" id="nudge-property-notice-card"><table><tbody><tr><td>
<span class="secondary-notice-card-header" id="nudge-property-card-header">Did you know?</span>
<p>Prompt replies to guests result in fewer cancellations and can improve review scores.</p>
<p>Replying to this email, will be sent directly to the guest.</p>
</td></tr></tbody></table></div>
</div>
</div>
<div class="booking-info-section" id="booking-info-section">
<strong>Booking details</strong>
<div><h1>Kozi Stays @ Vortex KLCC <div class="badge Confirmed">Confirmed </div></h1></div>
<table><tbody class="hidden-mobile"><tr><td class="bkg-info-table-item-label">Booking ID</td></tr><tr><td class="bkg-info-table-item-value" id="booking-id">1700000001</td></tr></tbody></table>
</div>
<hr/>
<div style="background-color: #F6F8FC" id="footer">
<p class="footer">Except to the extent that Agoda Company Pte. Ltd (“Agoda”) may need to intervene to provide reservation and other support services, all information contained herein is information exchanged between an Agoda user and the relevant accommodation provider.</p>
<hr/>
<p class="footer footer-send-by">This email was sent by: Agoda Company Pte. Ltd., 36 Robinson Road, #20-01 City House, Singapore 068877</p>
</div>
</div>
</div>
</body>
</html>
`;

export const specialText = `www.agoda.com

http://tracking.agoda.com/click?cid=1798843&name=hermes-guest-email&memberID=1&messageId=2&abUser=Z&conversationId=3&messageType=Message
&templateName=special_request&propertyId=90000001&redirectUrl=https://www.agoda.com/partners/tracking.aspx?CID%3D1798843%26oc%3D1&linkType=logo

NEW MESSAGE FROM MEI TAN

property icon Mei
Tan Oct 26, 04:28 PM ICT Oct 26, 04:28 PM ICT

--------------------------------------------------------------------------------

Dear Kozi Stays @ Vortex KLCC,

Requested: Non-smoking, Large bed, High floor, Quiet room
Additional notes: Away from elevator.

Please confirm below if you agree to the special requests.

Google
translate

Requested: Non-smoking, Large bed, High floor, Quiet room
Additional notes: Away from elevator.

Accepted

Subject to
availability

Not accepted

Reply through YCS
[(http://tracking.agoda.com/…)
&templateName=special_request&linkType=ycs_button&redirectUrl=https://portal.agoda.com/mldc/en-us/app/hermes/inbox/ycs/90000001/?conversation=3]

Did you know?

Prompt replies to
guests result in fewer cancellations and can improve review scores.

Booking details

KOZI STAYS @ VORTEX KLCC
CONFIRMED

--------------------------------------------------------------------------------

Except to the extent that Agoda Company Pte. Ltd (“Agoda”) may need to intervene
to provide reservation and other support services.

This email was sent by: Agoda Company Pte. Ltd., 36 Robinson Road, #20-01 City
House, Singapore 068877
`;

export const replyHtml = `
<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.0 Transitional//EN" "http://www.w3.org/TR/REC-html40/loose.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><meta content="text/html; charset=utf-8" http-equiv="Content-Type"><style type="text/css">a { text-decoration: underline; }</style></head>
<body yahoo="fix">
<table><tr><td agoda-marker="doc">
<table height="50" class="header"><tr><td>
<a href="http://tracking.agoda.com/click?cid=1798841&amp;linkType=logo&amp;templateName=" target="_blank" title="Agoda.com"><img src="https://cdn6.agoda.net/images/hermes/20190724/agoda-logo-hermes-email@2x.png" alt="Agoda.com"/></a>
</td><td><p id="hi_label">Hi, Kozi Stays @ Vortex KLCC</p></td></tr></table>
<table class="body"><tr><td>
<table bgcolor="#dae1ed" width="100%"><tr><td id="headerTitle">This traveler has an upcoming booking at your property. </td></tr></table>
<table class="inquiry-message">
<tr><td colspan="4" id="noticeHeader">New <b>inquiry</b> from Mei Tan </td></tr>
<tr><td colspan="4"><table width="100%">
<td><img id="topAvatarImage" src="https://cdn6.agoda.net/images/avatar/Avatars40x40@2x/M.png" height="40" width="40"/></td>
<td><table><tr><td><table><tbody>
<tr><td class="senderName" id="sender">Mei Tan</td><td class="senderDate">Oct 26, 04:42 PM ICT</td></tr>
<tr><td id='bookingId'>Booking ID: 1700000001</td></tr>
</tbody></table></td></tr>
<tr><td><table><tbody><tr><td>
<div id="mainTranslatedMessageContent">One room with an extra bed and one with a queen bed?<br>Thank you</div>
<div style="height: auto;background-color: #fafafa;padding: 10px;">
<div style="font-size: 9px;">The above text was translated automatically (via Google Translate) from the original message below:</div>
<div id="mainMessageContent" style="font-size: 14px;">一间房加床，另一间是大床吗？<br>谢谢</div>
</div>
</td></tr></tbody></table>
<div id="nudge-property-notice-card"><span id="nudge-property-card-header">Did you know?</span><div>Prompt replies to guests result in fewer cancellations and can improve review scores.</div></div>
</td></tr></table></td>
</table></td></tr>
<tr><td><a id='replyLink' href="https://go.onelink.me/Vq0Z?pid=QR&amp;c=ycs_chat&amp;af_force_deeplink=true " target="_blank"> <span>REPLY IN YCS APP</span> </a></td></tr>
<tr><td id='propertyInfo1' colspan="4">Kozi Stays @ Vortex KLCC Dec 31, 2026 - Jan 1, 2027</td></tr>
</table>
<table id="host-previous-conversations" class="host-previous-conversations"><tr><td>
<p name="historyStatusMessage">IMPORTANT: This feature allows direct communication between guests and booking suppliers.</p>
<table id="t1"><tr><td class="senderName" id="sender">Mei Tan</td><td class="senderDate">Oct 26, 04:31 PM ICT</td></tr>
<tr><td class="prevconvo"><span class="nomsg">How many rooms for this booking ?</span></td></tr></table>
</td></tr></table>
</td></tr></table>
<table id="footer"><tr><td><p>Except to the extent that Agoda Company Pte. Ltd (“Agoda”) may need to intervene to provide reservation and other support services.</p></td></tr></table>
</td></tr></table>
</body>
</html>
`;

export const replyText = `Agoda.com

(http://tracking.agoda.com/…)
&templateName=

Hi, Kozi Stays @ Vortex KLCC

This traveler has an upcoming booking at your property.

  New inquiry from Mei Tan





  Mei Tan Oct 26, 04:42 PM ICT     Booking ID: 1700000001


One room with an extra bed and one with a queen bed?
Thank you
The above text was translated automatically (via Google Translate) from the
original message below:
一间房加床，另一间是大床吗？
谢谢

Did you know?
Prompt replies to
guests result in fewer cancellations and can improve review scores.

REPLY IN YCS APP
[https://go.onelink.me/Vq0Z?pid=QR&c=ycs_chat&af_force_deeplink=true
] To chat live with your guest, use the YCS app.

--------------------------------------------------------------------------------

Kozi Stays @ Vortex KLCC Dec 31, 2026 - Jan 1, 2027 Standard City View | 1 room

Responding to this inquiry is easy! Just reply to this email like any other
email, and it will be sent to your guest directly.

IMPORTANT: This feature allows direct communication between guests and booking
suppliers.

  Oct 26, 04:38 PM ICT Kozi Stays @ Vortex KLCC

  2 Rooms Sir

  Mei Tan Oct 26, 04:31 PM ICT

  How many rooms for this booking ?
`;
