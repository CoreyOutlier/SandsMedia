export function storageConfigured() { return !!(process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.DRIVE_ROOT_FOLDER_ID); }
