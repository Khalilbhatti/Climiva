# Climvia manual QA checklist

**About 25 minutes. No code, no database tools.** Walk through these as the person named in each part. A check passes only if you can do it **without asking anyone what something means**. If you hesitate, that is a finding: write down the page and what confused you.

Use a normal laptop window (about 1280 wide) unless a step says phone. Keep a note of anything marked **✗**.

## Before you start

You need the app running (a developer or the deployment gives you the address) and:

- an email address you can make up for a new business (`anything@example.test` works);
- the **sample business sign-in** (Apex Climate Heating & Air): owner `alex.morgan@apex.test`, team member `jamie.rivera@apex.test`; the password is the `SEED_PASSWORD` in the environment file (ask a developer; do not paste it into notes);
- for part 6 only, a **platform administrator** account (a developer grants one with `npm run platform-admin:grant -- --email <address>`).

---

## 1. A brand-new owner (8 min)

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

## 2. An owner on a normal day (6 min)

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
| 4.3 | Fill the form and submit the request. | The result says **Request received** / **Appointment request submitted**, in a **plain neutral** panel with a clock icon, and explains the team will confirm. It must **not** look like the green **Booking confirmed** of an instant booking. |

## 5. A team member (2 min)

Sign in as `jamie.rivera@apex.test`.

| # | Do this | You should see |
| --- | --- | --- |
| 5.1 | Open **Overview**. | Today and Needs your attention are there to read. There is **no** Getting started, **no** Quick actions, **no** Create booking, **no** New button. |
| 5.2 | Open a customer, then **Website**. | No **Create booking** or **Request review** on the customer. No **Edit website** or **Publish** on Website. |

## 6. The platform console (2 min)

Sign in at `/platform-admin/login` as a platform administrator.

| # | Do this | You should see |
| --- | --- | --- |
| 6.1 | Look at the page. | A **dark** menu on the left (a business workspace is light), the word **Platform**, and your name with **Super administrator**. No business switcher. |
| 6.2 | Open **Organizations**, **Marketplace Listings**, **Reviews / Moderation**. | Each opens and the current one is highlighted. Text is readable on the dark menu. |

---

## What to write down

For each **✗**: the part and number, what you expected, what you saw, and a screenshot if you can. Also note **anything you had to guess**, even when it worked: wording that is not plain is a defect here.
