---
paths:
  - 'app/Actions/Projects/**'
---

# Projects

## Every model length is millimetres
The CAD document stores every length in millimetres regardless of the project's `units`. Imperial is a display concern only — `resources/js/lib/cad/units.ts` formats and parses feet/inches on the way in and out.

Never store feet, inches or metres in the document, and never compare a stored value against a formatted one.</note>
</invoke>

## Documents are normalized on read, never trusted from storage
ProjectController::show passes every stored document through BuildStarterDocument::normalize(), which backfills missing units/levels/wallTypes/doorTypes/windowTypes/viewSettings from the starter defaults. The editor assumes those catalogues exist (it reads wallTypes[0] on mount), so a partial document reaching the client is a black-screen crash. If you add a new document-level key the editor dereferences unconditionally, add it to normalize() and to the updateDocument validation in the same change.
