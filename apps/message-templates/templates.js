// The built-in templates, written by hand. Blanks are written {{Like this}}.
// A blank's value is shared by every template using the same name, so
// {{Your name}}, {{Your email}}, {{Your phone}} and {{Your LinkedIn}} (saved
// once under "Your details") fill in everywhere, as do {{Company}}, {{Role}}…
//
// To add one: copy an entry, give it a unique id (lowercase, dashes), and keep
// the wording plain and short enough to send without heavy editing.
(window.MessageTemplates = window.MessageTemplates || {}).TEMPLATES = [
  // ---------- Job search ----------
  {
    id: "application-follow-up",
    category: "Job search",
    title: "Following up on an application",
    when: "About one to two weeks after applying, if you haven't heard anything.",
    subject: "Following up on my application for {{Role}}",
    body: `Hi {{Contact name}},

I applied for the {{Role}} position at {{Company}} on {{Date you applied}} and wanted to follow up. I'm still very interested, especially because {{Something about the role or company that appeals to you}}.

If there's anything else you need from me, I'm happy to send it. Thank you for your time.

Best regards,
{{Your name}}
{{Your email}}`
  },
  {
    id: "interview-thank-you",
    category: "Job search",
    title: "Thank you after an interview",
    when: "Within a day of the interview.",
    subject: "Thank you for your time today",
    body: `Hi {{Interviewer name}},

Thank you for speaking with me about the {{Role}} role today. I enjoyed hearing about {{Something you discussed}}, and it made me even more excited about the chance to join {{Company}}.

Our conversation reinforced that my experience with {{A relevant skill or experience}} would let me contribute quickly. Please let me know if I can provide anything else.

Best regards,
{{Your name}}`
  },
  {
    id: "interview-follow-up",
    category: "Job search",
    title: "Checking in after an interview",
    when: "When the date they gave for a decision has passed, or about a week after the interview.",
    subject: "Checking in: {{Role}} interview",
    body: `Hi {{Contact name}},

I hope you're well. I interviewed for the {{Role}} position on {{Interview date}} and wanted to check in on the next steps. I'm still very interested in the role and in joining {{Company}}.

Thank you again for your time, and I look forward to hearing from you.

Best regards,
{{Your name}}`
  },
  {
    id: "rejection-feedback",
    category: "Job search",
    title: "Asking for feedback after a rejection",
    when: "After being turned down. Keep it short: many companies can't share feedback.",
    subject: "Thank you, and a quick request",
    body: `Hi {{Contact name}},

Thank you for letting me know about your decision on the {{Role}} role. While I'm disappointed, I appreciated the chance to learn about {{Company}}.

If you're able to share any feedback on my application or interviews, I'd be grateful. I understand if that isn't possible.

I'd be glad to be considered for future openings.

Best regards,
{{Your name}}`
  },
  {
    id: "recruiter-yes",
    category: "Job search",
    title: "Replying to a recruiter: interested",
    when: "A recruiter reached out about a role you'd like to hear more about.",
    subject: "Re: {{Role}}",
    body: `Hi {{Recruiter name}},

Thanks for reaching out. The {{Role}} role at {{Company}} sounds interesting, and I'd be glad to learn more.

I'm available {{Times you're free to talk}}. Could you also share the salary range and whether the role is remote, hybrid or on-site?

Best regards,
{{Your name}}
{{Your phone}}`
  },
  {
    id: "recruiter-no",
    category: "Job search",
    title: "Replying to a recruiter: not interested",
    when: "A recruiter reached out, the role isn't right, but you'd like to stay in touch.",
    subject: "Re: {{Role}}",
    body: `Hi {{Recruiter name}},

Thank you for thinking of me for the {{Role}} role. It isn't the right fit for me at the moment, but I'd be happy to hear about future roles in {{The kind of role you're looking for}}.

Best regards,
{{Your name}}`
  },
  {
    id: "offer-accept",
    category: "Job search",
    title: "Accepting a job offer",
    when: "Once you've decided, and the details in the offer are what you agreed.",
    subject: "Offer acceptance: {{Role}}",
    body: `Hi {{Contact name}},

Thank you for the offer for the {{Role}} position. I'm delighted to accept, and I'm looking forward to joining {{Company}}.

As discussed, I'll start on {{Start date}}. Please let me know if there's anything you need from me before then.

Best regards,
{{Your name}}`
  },
  {
    id: "offer-decline",
    category: "Job search",
    title: "Declining a job offer",
    when: "You've decided not to take an offer and want to leave a good impression.",
    subject: "{{Role}} offer",
    body: `Hi {{Contact name}},

Thank you very much for offering me the {{Role}} position. After careful thought, I've decided to decline, as I've accepted a role that's a closer fit for where I want to go next.

I really appreciated getting to know the team at {{Company}}, and I hope our paths cross again.

Best regards,
{{Your name}}`
  },
  {
    id: "offer-negotiate",
    category: "Job search",
    title: "Negotiating an offer",
    when: "You've received an offer and want to ask for more. Ask for something specific and say why.",
    subject: "Re: {{Role}} offer",
    body: `Hi {{Contact name}},

Thank you for the offer for the {{Role}} role. I'm excited about joining {{Company}}.

Before I accept, I'd like to discuss the base salary. Based on {{Your reason, e.g. market data or another offer}}, I was hoping for {{Amount you're asking for}}. If we can reach that, I'm ready to accept.

Thank you for considering this. I'm happy to talk it through on a call.

Best regards,
{{Your name}}`
  },
  {
    id: "offer-more-time",
    category: "Job search",
    title: "Asking for more time to decide",
    when: "You need a few more days before answering an offer.",
    subject: "Re: {{Role}} offer",
    body: `Hi {{Contact name}},

Thank you again for the offer. I'm very interested and want to give it the consideration it deserves. Would it be possible to give you my answer by {{Date you'll answer by}}?

Best regards,
{{Your name}}`
  },
  {
    id: "withdraw-application",
    category: "Job search",
    title: "Withdrawing an application",
    when: "You've accepted another job or are no longer interested.",
    subject: "Withdrawing my application: {{Role}}",
    body: `Hi {{Contact name}},

Thank you for considering me for the {{Role}} position. I'm writing to withdraw my application, as {{Short reason, e.g. I've accepted another offer}}.

I appreciate the time you and the team spent with me, and I wish you all the best in filling the role.

Best regards,
{{Your name}}`
  },

  // ---------- Networking ----------
  {
    id: "informational-chat",
    category: "Networking",
    title: "Asking for a short chat",
    when: "Reaching out to someone whose work or career path you'd like to learn about.",
    subject: "Quick question about your work at {{Their company}}",
    body: `Hi {{Their name}},

I came across your profile {{Where you found them}} and was interested in your work on {{Something specific they've done}}. I'm {{One line about you}}, and I'd love to hear how you got into {{Their field}}.

Would you have 15 minutes for a call in the next couple of weeks? I'm happy to work around your schedule.

Thank you,
{{Your name}}`
  },
  {
    id: "referral-request",
    category: "Networking",
    title: "Asking for a referral",
    when: "Someone you know works at a company with an opening you fit.",
    subject: "Would you be open to referring me for {{Role}}?",
    body: `Hi {{Their name}},

I hope you're doing well. I noticed {{Company}} is hiring for a {{Role}} ({{Link to the job}}), and I think it's a strong match for my experience with {{Your most relevant experience}}.

Would you be comfortable referring me? I've attached my resume, and I'm happy to send a short summary you could pass along. No worries at all if it's not something you can do.

Thanks so much,
{{Your name}}`
  },
  {
    id: "reconnect",
    category: "Networking",
    title: "Reconnecting with an old contact",
    when: "Getting back in touch with someone you haven't spoken to in a while.",
    subject: "It's been a while",
    body: `Hi {{Their name}},

It's been a while since {{How you know each other}}. I hope things are going well at {{Their company}}.

I'm currently looking for my next role in {{The kind of role you're looking for}}, and I thought of you. If you hear of anything, or know someone I should talk to, I'd really appreciate it. And I'd love to catch up either way.

Best,
{{Your name}}`
  },
  {
    id: "reference-request",
    category: "Networking",
    title: "Asking someone to be a reference",
    when: "Before you give out someone's name as a reference.",
    subject: "Would you be a reference for me?",
    body: `Hi {{Their name}},

I'm applying for a {{Role}} position at {{Company}}, and I'd be grateful if you'd be one of my references. I think you could speak well to {{What you'd like them to talk about}} from our time working together.

If you're happy to, I'll send you the job description and a short update on what I've been doing. And if now isn't a good time, I completely understand.

Thank you,
{{Your name}}`
  },
  {
    id: "thank-for-help",
    category: "Networking",
    title: "Thanking someone for their help",
    when: "After someone gave you advice, an introduction or a referral.",
    subject: "Thank you",
    body: `Hi {{Their name}},

I wanted to say thank you for {{What they did for you}}. It really helped, and {{What happened as a result}}.

I'd be glad to return the favor anytime.

Best,
{{Your name}}`
  },

  // ---------- Work ----------
  {
    id: "resignation",
    category: "Work",
    title: "Resignation letter",
    when: "Formally resigning. Tell your manager in person first if you can.",
    subject: "Resignation: {{Your name}}",
    body: `Dear {{Manager name}},

Please accept this letter as formal notice of my resignation from my position as {{Your job title}} at {{Company}}. My last day will be {{Last working day}}.

Thank you for the opportunities I've had here. I'll do everything I can to make the handover smooth.

Sincerely,
{{Your name}}`
  },
  {
    id: "raise-request",
    category: "Work",
    title: "Asking for a raise",
    when: "Setting up a conversation about your pay. Bring specific results.",
    subject: "Time to discuss my compensation",
    body: `Hi {{Manager name}},

Could we set aside 30 minutes in the next couple of weeks to talk about my compensation?

Over the past {{Time period}}, I've {{Your key results, with numbers if you have them}}. I'd like to discuss how my pay reflects that, and I'll bring some notes so we can make good use of the time.

Thank you,
{{Your name}}`
  },
  {
    id: "time-off",
    category: "Work",
    title: "Requesting time off",
    when: "Asking for leave, ideally well ahead of time.",
    subject: "Time off request: {{Dates}}",
    body: `Hi {{Manager name}},

I'd like to request time off from {{Dates}}. Before I leave, I'll {{How your work will be covered}}.

Please let me know if those dates work.

Thanks,
{{Your name}}`
  },
  {
    id: "out-of-office",
    category: "Work",
    title: "Out-of-office reply",
    when: "Automatic reply while you're away.",
    subject: "Out of office until {{Return date}}",
    body: `Thank you for your message. I'm out of the office until {{Return date}} with limited access to email.

For anything urgent, please contact {{Backup person and their email}}. Otherwise I'll reply when I'm back.

{{Your name}}`
  },

  // ---------- Everyday ----------
  {
    id: "refund-request",
    category: "Everyday",
    title: "Requesting a refund",
    when: "Something you bought was faulty, wrong or not delivered.",
    subject: "Refund request: order {{Order number}}",
    body: `Hello,

On {{Purchase date}} I ordered {{What you bought}} (order {{Order number}}). Unfortunately {{What went wrong}}.

I'd like a full refund to my original payment method. Please let me know if you need anything else from me, such as photos or the item returned.

Thank you,
{{Your name}}
{{Your email}}`
  },
  {
    id: "cancel-service",
    category: "Everyday",
    title: "Cancelling a subscription or service",
    when: "Ending a contract or subscription in writing, so you have a record.",
    subject: "Cancellation request: account {{Account number}}",
    body: `Hello,

Please cancel my {{Service name}} subscription (account {{Account number}}), effective {{Date it should end}}.

Please confirm the cancellation in writing, including the date of the final charge.

Thank you,
{{Your name}}
{{Your email}}`
  },
  {
    id: "complaint",
    category: "Everyday",
    title: "Making a complaint",
    when: "Raising a problem with a company calmly and clearly.",
    subject: "Complaint about {{What it's about}}",
    body: `Hello,

I'm writing about {{What it's about}} on {{Date}}. {{What happened, briefly and factually}}.

To resolve this, I'd like {{What you'd like them to do}}. I'd appreciate a reply by {{Date you'd like a reply by}}.

Thank you,
{{Your name}}
{{Your email}}`
  },
  {
    id: "decline-invitation",
    category: "Everyday",
    title: "Politely declining an invitation",
    when: "Saying no without over-explaining.",
    subject: "Re: {{Event}}",
    body: `Hi {{Their name}},

Thank you so much for inviting me to {{Event}}. Unfortunately I can't make it this time, but I hope it's a great day, and I'd love to catch up soon.

Best,
{{Your name}}`
  }
];
