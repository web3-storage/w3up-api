# Dedup Space Diff Table

A bug that caused duplicate entries in the `space-diff` table has been identified and fixed. To ensure the table reflects the correct state, it is essential that only one item with a specific `cause` exists. This requires identifying the duplicates and removing the most recently inserted one.

Please see the steps that need to be followed below:

1. **Get the data:** Export the table data to S3 and download the `.json.gz` files.
2. **Identify the Duplicates:** run the `1-identify-duplicates.js`, passing the exported files folder path.
3. **Remove the Dyplicates:** run the `2-remove-duplicates.js`.
