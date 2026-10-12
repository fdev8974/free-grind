# Legal agreements, WIP

- DELETE /v5/legal-agreements/subscriber-sponsored-content SponsoredContentAcceptConsentRequest (yes, with body)
- POST /v5/legal-agreements/subscriber-sponsored-content SponsoredContentAcceptConsentRequest
- GET /v5/legal-agreements/subscriber-sponsored-content . SponsoredContentConsentAgreementResponse
- POST /v1/agreements/ban BanAgreementRequest

- GET /v3/me/legal-agreements . AcceptedLegalAgreementsResponse
- DELETE /v5/legal-agreements/vip-matchmaker VipMatchmakerAcceptConsentRequest
- GET /v5/legal-agreements/vip-matchmaker . VipMatchmakerConsentAgreementResponse
- POST /v5/legal-agreements/vip-matchmaker VipMatchmakerAcceptConsentRequest
- DELETE /v4/legal-agreements/top-picks
- GET /v5/legal-agreements/top-picks . TopPicksConsentAgreementResponse
- GET /v4/legal-agreements/right-now . RightNowConsentAgreementResponse
- DELETE /v5/legal-agreements/top-picks TopPicksAcceptConsentRequest
- PUT /v3/me/legal-agreements AcceptLegalAgreementsRequest
- POST /v4/legal-agreements/right-now RightNowAcceptConsentRequest
- POST /v4/legal-agreements/top-picks TopPicksAcceptConsentRequest
- GET /v4/legal-agreements/top-picks . TopPicksConsentAgreementResponse
- GET /v3/legal-agreements . LegalAgreementsInfo

- PUT /v1/opt-out ConsentRequest
- DELETE /v1/opt-out ConsentRequest (body)
- POST /v1/opt-out ConsentRequest ConsentOptStatusResponse


## Terms of Service & Privacy Policy

Versions are date stamps. The app compares them on login and asks for acceptance when the accepted version is missing or older than the latest one.

`GET /v3/legal-agreements`

```json
{
  "legalAgreements": {
    "termsOfServiceUrl": "https://trust.grindr.com/en-US/legal",
    "latestTermsOfServiceVersion": "20260706",
    "privacyPolicyUrl": "https://trust.grindr.com/en-US/privacy",
    "latestPrivacyPolicyVersion": "20260706"
  }
}
```

`GET /v3/me/legal-agreements`

```json
{
  "termsOfServiceVersion": "20260706",
  "privacyPolicyVersion": "20260706",
  "userConsentList": ["VACCINE_COLLECT", "DOXYPEP_COLLECT", "HIV_COLLECT"],
  "createdAtPrivacyAgreement": 1791752920001,
  "createdAtTermsAgreement": 1791752920001
}
```

`PUT /v3/me/legal-agreements` — `userConsentList` only adds consents, it can't remove any, so an empty list leaves the existing ones untouched.

```json
{
  "termsOfServiceVersion": 20260706,
  "privacyPolicyVersion": 20260706,
  "userConsentList": []
}
```
