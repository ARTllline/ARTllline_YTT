<?php

return ['receipt_retention_days' => (int) env('TABLETOP_RECEIPT_RETENTION_DAYS', 7), 'execution_retention_days' => (int) env('TABLETOP_EXECUTION_RETENTION_DAYS', 90)];
