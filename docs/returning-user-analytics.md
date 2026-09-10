# Returning-user analytics

The app records one `app_session` event per browser tab session through Vercel Web Analytics.

Each event includes:

- `visitor_status`: `new` or `returning`
- `account_type`: `guest` or `signed_in`
- `days_since_previous_visit`: number of days since the browser last opened the app

In Vercel, open **Analytics → Events**, select `app_session`, and filter `visitor_status` to `returning`.

The tracker does not send email addresses, names, user IDs, Bible messages, or conversation content. Guest recognition is limited to the same browser profile and can reset if browser storage is cleared or the visitor changes devices.
