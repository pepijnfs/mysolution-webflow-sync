# Schema Model Comparison: Mysolution vs Webflow

## Overview
This document compares the job schema models between Mysolution and Webflow to ensure proper data synchronization.

## Mysolution Job Schema
Based on `job-output-single.json`:

```json
{
  "id": "a0wd1000000FJToAAO",
  "name": "Senior Salesforce Consultant",
  "title": "Wervende Titel Senior Salesforce Consultant<br>",
  "jobNumber": "2025-00001",
  "status": "Online",
  "account": {
    "id": "001d1000009Vf0AAAS",
    "name": "Mysolution BV"
  },
  "educationLevel": "HBO",
  "experienceLevel": "Medior",
  "hoursPerWeek": 40,
  "salary": {
    "from": 3000,
    "to": 4500
  },
  "professionalField": "IT",
  "showOnWebsite": true,
  "linkedToMasterJob": {
    "id": "a0wd1000000EPeVAAW",
    "name": "Ervaren Salesforce Consultant"
  },
  "jobDescription": "<h2><strong>Functieomschrijving</strong></h2>Wij zijn op zoek naar een ervaren implementatie consultant met een achtergrond in Recruitment en affiniteit met software. Als Salesforce consultant met 5 jaar ervaring, zul je een cruciale rol spelen in het optimaliseren van onze systemen en processen.<br><ul><li>Optimalisatie van Salesforce-systemen</li><li>Implementatie van nieuwe functies</li><li>Training en ondersteuning van gebruikers</li></ul>",
  "jobRequirements": "<h2><strong>Functie-eisen</strong></h2>We zijn op zoek naar een ervaren implementatie consultant met een achtergrond in Recruitment en affiniteit met software. Als Salesforce consultant met minimaal 5 jaar ervaring, ben jij de perfecte kandidaat voor deze rol.<br><ul><li>Minimaal 5 jaar ervaring als Salesforce consultant</li><li>Achtergrond in Recruitment</li><li>Affiniteit met software</li><li>Ervaring met implementatie projecten</li></ul>",
  "collectiveAgreement": "Mysolution uitzend (7384)",
  "jobLanguage": "nl_NL",
  "publishOnJobboards": false,
  "showOnInternal": false,
  "requestedQuantity": 1,
  "recruiter": {
    "id": "005d10000016Ji1AAE",
    "name": "Mysolution Recruitment"
  },
  "accountManager": {
    "id": "005d10000016Ji1AAE",
    "name": "Mysolution Recruitment"
  },
  "team": {
    "id": "a1Xd10000003iNvEAI",
    "name": "Testing Team"
  },
  "lastModifiedBy": {
    "id": "005d1000001NSSrAAO",
    "name": "Bart Schipper"
  },
  "employmentType": "Interim",
  "province": "Zuid-Holland",
  "hoursPerWeekRange": "36–40 uur",
  "sector": "Food & FCMG"
}
```

## Webflow Job Schema
Based on the Vacatures collection structure:

### Required Fields
1. `name` (PlainText)
   - Display Name: "Vacature Naam"
   - Max Length: 256 characters
   - Required: Yes

2. `slug` (PlainText)
   - Display Name: "Vacature Link"
   - Max Length: 256 characters
   - Required: Yes
   - Pattern: Alphanumerical, no spaces or special characters

### Optional Fields
1. `mysolution-id` (PlainText)
   - Display Name: "Mysolution ID"
   - Single Line: Yes

2. `job-excerpt-v1` (PlainText)
   - Display Name: "Vacature Highlight"
   - Single Line: Yes
   - Used for small text on small-sized Vacature Cards

3. `job-long-description-page` (PlainText)
   - Display Name: "Vacature Introductie"
   - Single Line: Yes
   - Used for short introduction on individual Vacature page

4. `job-requirements` (RichText)
   - Display Name: "Vacature Hoofdtekst"
   - Used for the actual job description

5. `job-responsibilities` (RichText)
   - Display Name: "Vacature Responsibilities"

6. `job-description` (RichText)
   - Display Name: "Vacature Requirements"

7. `vacature-locatie` (Option)
   - Display Name: "Vacature Locatie"
   - Options: All Dutch provinces (Rotterdam, Amsterdam, etc.)

8. `vacature-type` (Option)
   - Display Name: "Vacature Type"
   - Options: ["Interim", "Vast"]

9. `vacature-salaris` (Option)
   - Display Name: "Vacature Salaris"
   - Options: Salary ranges from "In overleg" to "200000"

10. `hourly` (Option)
    - Display Name: "Vacature Uurtarief"
    - Options: Hourly rates from "50" to "200" and "In overleg"

11. `job-is-featured` (Switch)
    - Display Name: "Uitgelicht"
    - Boolean field for featured jobs

12. `contactpersoon` (Reference)
    - Display Name: "Contactpersoon"
    - References the Recruiter/Employee working on the job

13. `job-companies` (Reference)
    - Display Name: "Vacature Sector"
    - References the sector/company collection

## Definitive Field Mapping

| Webflow Field | Mysolution Field | Notes |
|--------------|-----------------|-------|
| `name` | `name` | Direct mapping |
| `slug` | `name` | Auto-generated from name with "-" between words. If exists, append random 6-digit alphanumeric ID |
| `mysolution-id` | `id` | Direct mapping |
| `job-excerpt-v1` | `title` | Direct mapping |
| `job-long-description-page` | `title` | Direct mapping |
| `job-requirements` | `jobRequirements` | Direct mapping |
| `job-description` | `jobDescription` | Direct mapping (duplicate, to be handled later) |
| `vacature-locatie` | `province` | Direct mapping |
| `vacature-type` | `employmentType` | Direct mapping |
| `vacature-salaris` | `salary` | Use the salary object's from/to values |
| `hourly` | `salary` | Use the salary object's from/to values |
| `job-is-featured` | - | Ignored for now |
| `contactpersoon` | - | Ignored for now |
| `job-companies` | `sector` | Direct mapping |
| `uren-per-week` | `hoursPerWeekRange` | Direct mapping |

## Implementation Notes

1. **Slug Generation**
   - Convert name to lowercase
   - Replace spaces with hyphens
   - Remove special characters
   - Check for existing slugs
   - If exists, append random 6-digit alphanumeric ID

2. **Salary Mapping**
   - Both `vacature-salaris` and `hourly` use the same salary object
   - Need to determine appropriate salary ranges for the options

3. **HTML Content**
   - `job-requirements`, `job-responsibilities`, and `job-description` contain HTML content
   - Ensure proper HTML sanitization and formatting

4. **Duplicate Fields**
   - `job-description` is currently mapped to the same content as `job-responsibilities`
   - This will be handled in a future update

5. **Ignored Fields**
   - `job-is-featured` and `contactpersoon` are currently ignored
   - These may be implemented in future updates 