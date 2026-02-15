# Data Import System - User Guide

This guide explains how to use the CSV/XLSX data import system to bulk-upload master data like suppliers, customers, and products.

## Importable Modules

The system supports importing data for the following modules:
- `SUPPLIERS`
- `CUSTOMERS`
- `PRODUCTS`
- `OPENING_BALANCES`

## Required Fields Per Module

Your CSV or XLSX file must contain columns that can be mapped to these fields.

| Module | Required Fields | Optional Fields | Notes |
|---|---|---|---|
| `SUPPLIERS` | `name` | `phone`, `address`, `notes` | `name` must be unique per tenant. |
| `CUSTOMERS` | `name` | `phone`, `address`, `notes` | `name` must be unique per tenant. |
| `PRODUCTS` | `name` | `sku`, `category`, `unit` | `sku` must be unique per tenant if provided. |
| `OPENING_BALANCES` | `accountName`, `amount` | `accountType`, `notes` | `accountName` must match an existing Payment Account. The `amount` will **overwrite** the account's opening balance. |

---

## The 5-Step Import Process

The import process is designed to be safe and reversible, following these five steps:

### Step 1: Upload File

**Endpoint**: `POST /api/v1/imports`
**Content-Type**: `multipart/form-data`

Upload your data file. You must provide two form fields:
1.  `file`: The `.csv` or `.xlsx` file.
2.  `module`: The name of the module you are importing for (e.g., `SUPPLIERS`).

**Response:**
The system creates an "import batch" and returns its details. The batch will have a `PENDING_MAPPING` status. The response includes a list of `detectedColumns` from your file and the `requiredFields` for the module you selected.

```json
{
  "id": "uuid-for-batch",
  "status": "PENDING_MAPPING",
  "detectedColumns": ["Company Name", "Phone Number"],
  "requiredFields": [{ "field": "name", "required": true }]
}
```

### Step 2: Map Columns

**Endpoint**: `POST /api/v1/imports/:id/map`

Using the `id` from Step 1, you must now tell the system how the columns in your file map to the system's fields.

**Request:**
Send a JSON object where keys are the system field names and values are the column names from your file.

```json
{
  "columnMappings": {
    "name": "Company Name",
    "phone": "Phone Number"
  }
}
```

**Response:**
The system validates every row in your file based on this mapping. The batch status moves to `VALIDATED`. The response provides a summary of valid vs. invalid rows and a preview of any errors.

### Step 3: List and Review Batches

**Endpoints**: 
- `GET /api/v1/imports` (List all batches)
- `GET /api/v1/imports/:id` (Get a specific batch)

You can list all import batches, optionally filtering by `module` or `status`. This is useful for tracking the progress of multiple files.

You can also review a specific batch and its validation errors by fetching it by its `id`. This allows you to correct your source file and re-upload if there are too many errors.

### Step 4: Commit Import

**Endpoint**: `POST /api/v1/imports/:id/commit`

Once you are satisfied with the validation, you can commit the import. This is the step that actually creates records in the database.

**Request:**
You can optionally specify how to handle invalid rows. The default is to skip them.
```json
{
  "skipInvalidRows": true
}
```

**Response:**
The system creates the new records and updates the batch status to `COMPLETED`. The response includes a count of successful and failed rows.

### Step 5: Rollback (If Necessary)

**Endpoint**: `POST /api/v1/imports/:id/rollback`

If you make a mistake, you can roll back a `COMPLETED` import. This will delete all records created by that specific batch.

**Important**: A rollback will be **blocked** with a `409 Conflict` error if any of the created records have since been used in a transaction (e.g., a supplier you imported has a purchase associated with it). This is a safety feature to prevent data corruption.

---

## Full API Workflow Example

1.  `POST /api/v1/imports` with `suppliers.csv` and `module: "SUPPLIERS"`.
2.  Receive back `{ "id": "abc-123", "status": "PENDING_MAPPING", ... }`.
3.  `POST /api/v1/imports/abc-123/map` with your column mappings.
4.  Receive back `{ "status": "VALIDATED", "validRows": 98, "invalidRows": 2, ... }`.
5.  `POST /api/v1/imports/abc-123/commit`.
6.  Receive back `{ "status": "COMPLETED", "successRows": 98, ... }`.
7.  (If needed) `POST /api/v1/imports/abc-123/rollback`.
