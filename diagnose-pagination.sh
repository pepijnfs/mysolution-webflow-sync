#!/bin/bash

# Script to diagnose pagination issues in the Webflow integration

# Create a log directory if it doesn't exist
mkdir -p logs

# Get current timestamp for the log file
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="logs/pagination_diagnosis_${TIMESTAMP}.log"

echo "=========================================="
echo "  WEBFLOW PAGINATION DIAGNOSTIC TOOL"
echo "=========================================="
echo ""
echo "This tool will diagnose pagination issues with the Webflow API"
echo "and attempt to find why jobs aren't being synchronized correctly."
echo ""
echo "The results will be saved to: ${LOG_FILE}"
echo ""
echo "Running tests..."

# Run the pagination test and capture all output
node src/test-pagination.js | tee "${LOG_FILE}"

echo ""
echo "Tests completed. Check the logs for detailed information."
echo "Log file: ${LOG_FILE}"

# Search for potential issues in the log
echo ""
echo "Quick analysis of results:"

# Check for common error patterns
if grep -q "API error" "${LOG_FILE}"; then
  echo "⚠️ API errors detected. Check the log for details."
fi

if grep -q "PAGINATION ERROR" "${LOG_FILE}"; then
  echo "⚠️ Pagination errors detected. Check the log for details."
fi

if grep -q "alternative field name" "${LOG_FILE}"; then
  echo "⚠️ Detected inconsistent field names. Consider updating your code."
fi

if grep -q "Rate limit" "${LOG_FILE}"; then
  echo "⚠️ Rate limiting issues detected. You might be hitting Webflow API limits."
fi

echo ""
echo "Next steps:"
echo "1. Review the complete log file for detailed diagnostics"
echo "2. Update your code based on the findings"
echo "3. Run the sync process again to verify improvements"
echo "" 