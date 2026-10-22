# Climvia manual QA checklist

**About 30 minutes. No code, no database tools.** Walk through these as the person named in each part. A check passes only if you can do it **without asking anyone what something means**. If you hesitate, that is a finding: write down the page and what confused you.

Use a normal laptop window (about 1280 wide) unless a step says phone. Keep a note of anything marked **✗**.

## Before you start

You need the app running (a developer or the deployment gives you the address) and:

- an email address you can make up for a new business (`anything@example.test` works);
- the **sample business sign-in** (Apex Climate Heating & Air): owner `alex.morgan@apex.test`, team member `jamie.rivera@apex.test`; the password is the `SEED_PASSWORD` in the environment file (ask a developer; do not paste it into notes);
- for part 7 only, a **platform administrator** account (a developer grants one with `npm run platform-admin:grant -- --email <address>`).

---

## 1. A brand-new owner (7 min)

Sign out first. Start at the home page.

| # | Do this | You should see |
| --- | --- | --- |
| 1.1 | Choose **List Your Business**, then create an account and finish the five set-up steps. | You land on a page titled **Overview**. |
| 1.2 | Read the page without clicking. | A **Getting started** box that says **0 of 5 completed**, five steps in plain words, one big button **Create booking**, and nothing about bookings, money or jobs you never made. No numbers that look like results. |
| 1.3 | Look at the left menu. | Groups named **Work, Business, Money, Growth, Insights**. Overview and Customers stand alone. Nothing says "Marketplace" alone: it says **Marketplace Listing**. **Analytics** is reachable (scroll the menu if your window is short). |
| 1.4 | In Getting started choose **Add your first service**. | The **Add new service** window opens by itself, with steps called **Service basics, How customers book, Pricing, Where customers see it, Review**. |
| 1.5 | Add a service (any name, a short description, Instant booking, a price). | The window closes. The address bar shows `/services` with nothing extra. Press reload: the window does **not** open again. |
| 1.6 | Go back to **Overview**. | **1 of 5 completed**, and the service step is marked done. |
| 1.7 | Choose **Add your first customer** and add someone with a name, email and phone. | You land on that customer's page. At the top there is **Create booking**. There is **no** Request review button (no finished work yet). |
| 1.8 | Open **Marketplace Listing** from the menu. | One clear button, **Set up listing**, and one sentence saying nothing is public until you publish. No row of "Not set / Not selected" tiles. |
| 1.9 | Set it up and choose **Save & publish listing**. | You return to Marketplace Listing. The main button is now **View public profile**, and it opens a page that shows your business. |
| 1.10 | Back on **Overview**. | **3 of 5 completed** (service, customer, listing). Hide the box with the **×**: it stays hidden after a reload. |
| 1.11 | Open **Reviews**, **Marketing**, **Quotes & Invoices**, **Jobs**, **Bookings**. | Each says in a sentence what it is and what to do first. None shows a wall of zeros. |

## 2. An owner on a normal day (8 min)

Sign in as `alex.morgan@apex.test`.

| # | Do this | You should see |
| --- | --- | --- |
| 2.1 | Open **Overview**. | **Today**, **Needs your attention** (for example "2 booking requests are waiting for your answer"), **Coming up**, **In progress**, **This month**, **Quick actions**. The **Bookings** menu item has a small number: the requests waiting. |
| 2.2 | Choose the "waiting for your answer" line. | The Bookings **Requests** list. |
| 2.3 | Open one request and choose **Confirm booking**. | A message says it is confirmed, and the panel tells you what to do next ("Assign a technician, then create a job…"). |
| 2.4 | Open **Customers**, then **Sarah Mitchell**. | The top of the page shows **Create booking**. Sections are **Bookings, Properties, Equipment, Jobs, Contact, Maintenance plan** (those that apply). |
| 2.5 | Choose **Create booking** on her page. | The booking window opens with Sarah already chosen. Close it. |
| 2.6 | On **Overview**, choose a job under **Today**. | The job page. A back link returns you. |
| 2.7 | On **Overview**, choose the "invoices have not been paid in full" line. | The invoices list; open one: it shows **Related records** that link to its quote and payments. |
| 2.8 | Open the **New** button in the top bar. | Booking, Customer, Service, Payment. Choose **Customer**: the Add customer window opens. Cancel it: the address returns to `/customers`. |
| 2.9 | Type a name in that window, then choose **Cancel**. | It asks **Discard unsaved changes?** with **Keep editing** and **Discard changes**. With nothing typed, Cancel closes at once. |
| 2.10 | Open **Schedule**, choose **Day**. | The long date first, the time zone, and one line that says how many visits, how many still need a technician and what time it is now. A row of seven days with how much is on each. Under each technician's name, one line (**2 visits**, **Free all day**, **Blocked time only**). A line marked **Now**. |
| 2.11 | Look for an **arrival window** (Saturday, Oct 26: Hannah Wright). | Its block says **Arrival window**, is hatched, and the legend under the schedule says what the hatching and dashes mean. Press **Sun** in the day row: it says the business is closed on Sundays. |
| 2.12 | Open **Analytics** and read the six tab names. | **Overview, Bookings, Jobs, Revenue, Marketplace, Customer retention**. Each section is a question ("How many bookings are we getting?", "What is still outstanding?") and every number answers it. Nothing is predicted, scored or shown as a percentage. |
| 2.13 | Open **Settings**. | Five groups on the left: **Business, Booking & operations, Team & access, Website & domains, Account & workspace**. An item that is managed somewhere else says where ("Each Service sets its own booking method") and opens that page. |
| 2.14 | Open **Marketing**. | A note says Climvia keeps campaigns and **does not deliver** email or text messages, so a campaign marked Sent has not reached anyone. |

## 3. A review, start to finish (3 min)

Still as the owner.

| # | Do this | You should see |
| --- | --- | --- |
| 3.1 | Open **Customers → David Chen**. | **No** Request review button yet: his job is not finished. |
| 3.2 | Open **Jobs**, open **JB-201**, **Start job**, then **Complete job** with a short note. | The job completes. |
| 3.3 | Go back to David Chen's page. | **Request review** is now there. Choose it, then **Send review request**. A **Review link ready** window shows a link. |
| 3.4 | Open that link in a private/incognito window (not signed in). | A short page asking for a star rating and a few words. Send one. It thanks you. |
| 3.5 | Back in the owner's window, open **Reviews**. | David's review is listed, waiting for a reply. |

## 4. A homeowner on a phone (4 min)

Use a phone, or make the browser window about 390 wide. Not signed in.

| # | Do this | You should see |
| --- | --- | --- |
| 4.1 | Open the **Marketplace** page and search for a service and a place. | Provider cards that fit the screen. Nothing scrolls sideways. |
| 4.2 | Open a provider, then a service that is **Request appointment**. | The page says in words how this service is booked. |
| 4.2a | Open a provider from a search that named a service. | A bar along the bottom names that service, its price, and one button in the words of how it is booked: **Book a time**, **Request appointment** or **Request a quote**. It never covers the last line of the page. |
| 4.2b | Open the same provider without choosing a service. | The bar says **Choose a service to book** and **See services** takes you to the list. |
| 4.3 | Fill the form and submit the request. | The result says **Request received** / **Appointment request submitted**, in a **plain neutral** panel with a clock icon, and explains the team will confirm. It must **not** look like the green **Booking confirmed** of an instant booking. |

## 5. A team member (2 min)

Sign in as `jamie.rivera@apex.test`.

| # | Do this | You should see |
| --- | --- | --- |
| 5.1 | Open **Overview**. | Today and Needs your attention are there to read. There is **no** Getting started, **no** Quick actions, **no** Create booking, **no** New button. |
| 5.2 | Open a customer, then **Website**. | No **Create booking** or **Request review** on the customer. No **Edit website** or **Publish** on Website. |

## 6. Two businesses, one person (1 min)

Sign in as `casey.nguyen@climvia.test` (an admin in Apex and in Northstar).

| # | Do this | You should see |
| --- | --- | --- |
| 6.1 | Open **Overview** in Apex and hide **Getting started** with the **×**. | It stays hidden after a reload. |
| 6.2 | Switch to the other business from the top bar. | **Getting started** is there: hiding it in one business never hides it in the other. |

## 7. The platform console (2 min)

Sign in at `/platform-admin/login` as a platform administrator.

| # | Do this | You should see |
| --- | --- | --- |
| 7.1 | Look at the page. | A **dark** menu on the left (a business workspace is light), the word **Platform**, and your name with **Super administrator**. No business switcher. |
| 7.2 | Open **Organizations**, **Marketplace Listings**, **Reviews / Moderation**. | Each opens and the current one is highlighted. Text is readable on the dark menu. On Marketplace Listings, **Moderation** (Allow again, Keep suspended, Edit message) stays in view while the table scrolls. |

---

## 8. Comprehension questions (3 min)

Ask these of someone who has **not** seen the product, one page at a time, without helping. Write down the answer in their words. A wrong or hesitant answer is a finding, whatever the page says.

For each page below (Overview, Bookings, Schedule, Jobs, Customers, a customer, Services, Quotes & Invoices, Payments, Website, Marketplace Listing, Reviews, Marketing, Analytics, Settings, the public Marketplace, a provider's page on a phone):

1. **What is this page for?** (one sentence)
2. **What is the main thing you would do here?** Can they point to it?
3. **What happens next** after you do it? Where would you find the result?
4. **Is there a word on the page you would not use?** Which?
5. **If something went wrong, would you know what to do?** (Try an empty required field, or switch the connection off and save.)
6. **When it worked, did the page tell you so?** In what words?
7. **Where would you go next?** (A booking was confirmed: what now? A review was received: what now?)

Particular things to listen for: whether **Request appointment** is understood as *not yet confirmed*; whether **Sent** in Marketing is understood as *recorded, not delivered*; whether Analytics' "Where are they coming from?" is understood to count only bookings that say where they came from; and whether anyone looks for a way to **create a quote** (there is none yet: see `saas-architecture.md` section 42.9).

---

## What to write down

For each **✗**: the part and number, what you expected, what you saw, and a screenshot if you can. Also note **anything you had to guess**, even when it worked: wording that is not plain is a defect here.
