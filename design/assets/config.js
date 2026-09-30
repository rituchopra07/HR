/* Portal runtime configuration.
   trackerApi — base URL of the HR tracker API (server/, e.g. "https://hr-api.example.org/api").
                Leave empty and the POSH / Labour Codes / Payroll editors save in the browser only;
                set it once the shared database is live and they switch to shared, signed-in editing. */
window.HR_CONFIG = {
  trackerApi: ""
};
