(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
  let client = null;
  let currentUser = null;
  let selectedThreadId = "";
  let threads = [];

  function show(selector, visible) {
    const element = $(selector);
    if (element) element.hidden = !visible;
  }

  function configured() {
    const config = window.CINEJOY_SUPABASE;
    return Boolean(config && config.url && config.anonKey);
  }

  function setAuthMode(mode) {
    const button = $("[data-account-email-submit]");
    const toggle = $("[data-account-mode-toggle]");
    const heading = $("[data-account-heading]");
    const password = $("#account-password");
    const note = $("[data-account-provider-note]");
    if (!button || !toggle || !heading || !password || !note) return;
    button.textContent = mode === "signup" ? "Create account" : "Sign in";
    toggle.textContent = mode === "signup" ? "Already have an account? Sign in" : "Create an account instead";
    heading.textContent = mode === "signup" ? "Create your account." : "Sign in to your account.";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    note.textContent = mode === "signup"
      ? "Email confirmation may be required. New accounts can message support but do not receive admin permissions."
      : "Sign-in is provided by Supabase Auth. Admin permissions are separate and enforced by database policies.";
    const form = $("[data-account-email-form]");
    if (form) form.dataset.mode = mode;
  }

  function setAccountUnconfigured(message) {
    show("[data-account-unconfigured]", true);
    show("[data-account-auth]", false);
    show("[data-account-signed-in]", false);
    const target = $("[data-account-config-message]");
    if (target) target.textContent = message;
  }

  async function notifyOwner(threadId) {
    const config = window.CINEJOY_SUPABASE;
    if (!config.notifications || config.notifications.ownerEmailEnabled !== true) return false;
    try {
      const { data, error } = await client.functions.invoke("notify-contact", { body: { thread_id: threadId } });
      if (error) throw error;
      return Boolean(data && data.sent);
    } catch (error) {
      console.error("Cywrld owner email notification failed:", error);
      return false;
    }
  }

  async function initializeContact() {
    const status = $("[data-contact-auth]");
    const form = $("[data-contact-form]");
    if (!status || !form) return;
    if (!configured()) {
      status.innerHTML = `Online messaging is not configured yet. Nothing is submitted or stored. <a href="SUPABASE_SETUP.md">See the setup guide</a>.`;
      return;
    }
    if (!client) {
      status.textContent = "The Supabase Auth client did not load. Online messaging is unavailable.";
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      currentUser = data.session && data.session.user;
      if (!currentUser) {
        status.innerHTML = `Sign in or create an account to send a private message. <a href="account.html">Go to your account</a>.`;
        return;
      }
      status.textContent = `Signed in as ${currentUser.email || "your account"}. Your message will start a private thread.`;
      form.hidden = false;
    } catch (error) {
      console.error("Cywrld could not check the contact form session:", error);
      status.textContent = `Could not check your sign-in with Supabase: ${error.message}`;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity() || !currentUser) return;
      const submit = form.querySelector('[type="submit"]');
      const messageStatus = $("[data-contact-status]");
      submit.disabled = true;
      messageStatus.textContent = "Saving your private message…";
      try {
        const { data, error } = await client.rpc("create_message_thread", {
          p_subject: form.elements.subject.value,
          p_body: form.elements.message.value.trim()
        });
        if (error) throw error;
        if (typeof data !== "string" || !data) throw new Error("The server did not return a thread ID.");
        const notified = await notifyOwner(data);
        messageStatus.textContent = notified
          ? "Your message is saved in a private website thread. The site owner was notified by email."
          : "Your message is saved in a private website thread. No email notification was sent; you can check replies in Messages.";
        form.reset();
        window.setTimeout(() => { window.location.href = `messages.html?id=${encodeURIComponent(data)}`; }, 1200);
      } catch (error) {
        console.error("Cywrld could not create the message thread:", error);
        messageStatus.textContent = `Your message could not be saved: ${error.message}`;
      } finally {
        submit.disabled = false;
      }
    });
  }

  async function initializeAccount() {
    if (!$("[data-account-card]")) return;
    if (!configured()) {
      setAccountUnconfigured("Supabase is not configured yet. Nothing is signed in or saved online.");
      return;
    }
    if (!client) {
      setAccountUnconfigured("The Supabase browser SDK did not load. Connect to the internet to use online accounts; public film browsing remains available.");
      return;
    }

    show("[data-account-auth]", true);
    const providers = window.CINEJOY_SUPABASE.providers || {};
    show("[data-account-email-method]", providers.emailPassword === true);
    show("[data-account-google-method]", providers.google === true);
    if (providers.emailPassword !== true && providers.google !== true) {
      $("[data-account-auth-status]").textContent = "No sign-in provider is enabled. Configure a provider in Supabase and opt in through supabase-config.js.";
    }
    setAuthMode("signin");

    const displaySession = (session) => {
      currentUser = session && session.user;
      show("[data-account-signed-in]", Boolean(currentUser));
      show("[data-account-auth]", !currentUser);
      if (currentUser) $("[data-account-email-address]").textContent = currentUser.email || "Signed-in account";
    };
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    displaySession(data.session);
    client.auth.onAuthStateChange((_event, session) => window.setTimeout(() => displaySession(session), 0));

    const form = $("[data-account-email-form]");
    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const status = $("[data-account-auth-status]");
        const button = $("[data-account-email-submit]");
        button.disabled = true;
        status.textContent = form.dataset.mode === "signup" ? "Creating account with Supabase Auth…" : "Signing in with Supabase Auth…";
        try {
          const email = form.elements.email.value.trim();
          const password = form.elements.password.value;
          const result = form.dataset.mode === "signup"
            ? await client.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
            : await client.auth.signInWithPassword({ email, password });
          if (result.error) throw result.error;
          if (form.dataset.mode === "signup" && !result.data.session) {
            status.textContent = "Account created. Check your email for a confirmation link if required, then sign in.";
          } else {
            displaySession(result.data.session);
            status.textContent = "Account authenticated by Supabase.";
          }
        } catch (error) {
          console.error("Cywrld account authentication failed:", error);
          status.textContent = `Authentication failed: ${error.message}`;
        } finally {
          button.disabled = false;
        }
      });
      $("[data-account-mode-toggle]").addEventListener("click", () => {
        setAuthMode(form.dataset.mode === "signup" ? "signin" : "signup");
        $("[data-account-auth-status]").textContent = "";
      });
    }
    const google = $("[data-account-google]");
    if (google) {
      google.addEventListener("click", async () => {
        google.disabled = true;
        $("[data-account-auth-status]").textContent = "Redirecting to Google through Supabase Auth…";
        try {
          const { error: oauthError } = await client.auth.signInWithOAuth({
            provider: "google",
            options: { redirectTo: window.location.href }
          });
          if (oauthError) throw oauthError;
        } catch (error) {
          console.error("Cywrld Google OAuth could not start:", error);
          $("[data-account-auth-status]").textContent = `Google sign-in unavailable: ${error.message}. Check Supabase provider and redirect setup.`;
          google.disabled = false;
        }
      });
    }
    $("[data-account-signout]").addEventListener("click", async () => {
      const { error: signoutError } = await client.auth.signOut();
      if (signoutError) $("[data-account-auth-status]").textContent = `Sign-out failed: ${signoutError.message}`;
      else displaySession(null);
    });
  }

  function threadSummary(thread) {
    const date = new Date(thread.updated_at || thread.created_at);
    const formatted = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
    return `<button class="thread-list-item${thread.id === selectedThreadId ? " is-active" : ""}" type="button" data-open-thread="${escapeHTML(thread.id)}" aria-current="${thread.id === selectedThreadId ? "true" : "false"}"><strong>${escapeHTML(thread.subject)}</strong><span>${escapeHTML(thread.status)} · ${escapeHTML(formatted)}</span></button>`;
  }

  async function loadUserThreads() {
    const { data, error } = await client.from("message_threads")
      .select("id,subject,status,created_at,updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    threads = data;
    const list = $("[data-user-thread-list]");
    list.innerHTML = threads.length
      ? threads.map(threadSummary).join("")
      : `<p class="thread-list-empty">No conversations yet.</p>`;
    if (selectedThreadId && !threads.some((thread) => thread.id === selectedThreadId)) selectedThreadId = "";
    if (selectedThreadId) await openUserThread(selectedThreadId);
    else {
      show("[data-user-thread-view]", false);
      show("[data-user-new-thread]", false);
      show("[data-user-thread-empty]", true);
    }
  }

  async function openUserThread(id) {
    const thread = threads.find((item) => item.id === id);
    if (!thread) return;
    selectedThreadId = id;
    show("[data-user-thread-empty]", false);
    show("[data-user-new-thread]", false);
    show("[data-user-thread-view]", true);
    $("[data-user-thread-subject]").textContent = thread.subject;
    $("[data-user-thread-status]").textContent = thread.status;
    $("[data-user-reply-form] [type=submit]").disabled = thread.status !== "open";
    const transcript = $("[data-user-transcript]");
    transcript.innerHTML = `<p class="thread-list-empty">Loading conversation…</p>`;
    const { data, error } = await client.from("thread_messages")
      .select("id,sender_role,body,created_at")
      .eq("thread_id", id).order("created_at", { ascending: true });
    if (error) throw error;
    transcript.innerHTML = data.length ? data.map((message) => {
      const date = new Date(message.created_at);
      const formatted = Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
      const sender = message.sender_role === "admin" ? "Cywrld team" : "You";
      return `<article class="thread-message${message.sender_role === "admin" ? " from-admin" : ""}"><div><strong>${sender}</strong><time datetime="${escapeHTML(message.created_at)}">${escapeHTML(formatted)}</time></div><p>${escapeHTML(message.body)}</p></article>`;
    }).join("") : `<p class="thread-list-empty">No messages in this thread yet.</p>`;
    transcript.scrollTop = transcript.scrollHeight;
    $$(".thread-list-item").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.openThread === id);
      button.setAttribute("aria-current", button.dataset.openThread === id ? "true" : "false");
    });
  }

  function initializeMessages() {
    if (!$("[data-user-messages]")) return;
    const access = $("[data-messages-access]");
    if (!configured()) {
      access.innerHTML = `Private messages are unavailable until Supabase is configured. Nothing is stored on this device. <a href="SUPABASE_SETUP.md">Read the setup guide</a>.`;
      return;
    }
    if (!client) {
      access.textContent = "Supabase Auth did not load; online messages are unavailable.";
      return;
    }
    client.auth.getSession().then(async ({ data, error }) => {
      if (error) throw error;
      if (!data.session) {
        access.innerHTML = `Sign in or create an account to see your private threads. <a href="account.html">Open your account</a>.`;
        return;
      }
      currentUser = data.session.user;
      access.hidden = true;
      show("[data-user-messages]", true);
      $("[data-messages-account]").textContent = currentUser.email || "";
      const threadId = new URLSearchParams(window.location.search).get("id");
      if (threadId) selectedThreadId = threadId;
      await loadUserThreads();
    }).catch((error) => {
      console.error("Cywrld could not load the user's messages:", error);
      access.textContent = `Could not load private messages: ${error.message}`;
    });

    $("[data-user-thread-list]").addEventListener("click", async (event) => {
      const button = event.target.closest("[data-open-thread]");
      if (!button) return;
      try {
        await openUserThread(button.dataset.openThread);
      } catch (error) {
        $("[data-user-transcript]").textContent = `Could not load this conversation: ${error.message}`;
      }
    });
    $("[data-show-new-thread]").addEventListener("click", () => {
      show("[data-user-thread-empty]", false);
      show("[data-user-thread-view]", false);
      show("[data-user-new-thread]", true);
    });
    $("[data-user-new-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity()) return;
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const { data, error } = await client.rpc("create_message_thread", {
          p_subject: event.currentTarget.elements.subject.value,
          p_body: event.currentTarget.elements.body.value.trim()
        });
        if (error) throw error;
        if (typeof data !== "string" || !data) throw new Error("No conversation ID was returned.");
        event.currentTarget.reset();
        const notified = await notifyOwner(data);
        $("[data-messages-access]").textContent = notified
          ? "Message sent in your private thread. The site owner was notified."
          : "Message saved in your private thread. No email notification was sent.";
        selectedThreadId = data;
        await loadUserThreads();
      } catch (error) {
        console.error("Cywrld could not start the message thread:", error);
        $("[data-messages-access]").textContent = `Could not send the message: ${error.message}`;
        $("[data-messages-access]").hidden = false;
      } finally {
        button.disabled = false;
      }
    });
    $("[data-user-reply-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!event.currentTarget.reportValidity() || !selectedThreadId) return;
      const button = event.currentTarget.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const body = event.currentTarget.elements.body.value.trim();
        const { error } = await client.from("thread_messages").insert({ thread_id: selectedThreadId, body });
        if (error) throw error;
        const notified = await notifyOwner(selectedThreadId);
        event.currentTarget.reset();
        await loadUserThreads();
        $("[data-messages-access]").hidden = false;
        $("[data-messages-access]").textContent = notified
          ? "Reply added to your thread. The site owner was notified."
          : "Reply added to your thread. No email notification was sent.";
      } catch (error) {
        console.error("Cywrld could not send the thread reply:", error);
        $("[data-messages-access]").hidden = false;
        $("[data-messages-access]").textContent = `Could not send the reply: ${error.message}`;
      } finally {
        button.disabled = false;
      }
    });
    $("[data-site-signout]").addEventListener("click", async () => {
      const { error } = await client.auth.signOut();
      if (error) access.textContent = `Sign-out failed: ${error.message}`;
      else window.location.href = "account.html";
    });
  }

  function initialize() {
    document.querySelectorAll("[data-current-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
    if (configured() && window.supabase && typeof window.supabase.createClient === "function") {
      const config = window.CINEJOY_SUPABASE;
      client = window.supabase.createClient(config.url.trim().replace(/\/+$/, ""), config.anonKey.trim());
    }
    initializeContact();
    initializeAccount().catch((error) => {
      console.error("Cywrld could not initialize the account page:", error);
      const status = $("[data-account-auth-status]");
      if (status) status.textContent = `Supabase Auth error: ${error.message}`;
    });
    initializeMessages();
  }

  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  document.addEventListener("DOMContentLoaded", initialize);
})();
