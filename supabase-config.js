/* Public browser settings only. The anon key is safe to expose when RLS is configured. */
window.CINEJOY_SUPABASE = Object.freeze({
  url: "",
  anonKey: "",
  providers: Object.freeze({
    emailPassword: false,
    google: false
  }),
  notifications: Object.freeze({
    ownerEmailEnabled: false
  }),
  payments: Object.freeze({
    checkoutEnabled: false
  })
});
