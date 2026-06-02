# BRUNHOLL ORDERS – MASTER SPEC

## Project Goal

Brunholl Orders is a restaurant and guesthouse operational ordering system.

The application is designed for:

* Bar / Waiter Tablet
* Kitchen Tablet
* Reception Screen

The system is not a POS system.

Permanent sales history is stored in the external cash register system.

Brunholl Orders is used for live service operations only.

---

# Core Principles

* Light theme only
* Black text wherever possible
* Touch-first design
* Fast workflow
* Minimal clicks
* High readability under pressure
* Tablet optimized
* Mobile responsive

---

# Table Layout

Tables remain visual.

Layout:

5  10A 10B 13
4   9A  9B 12
3   8A  8B 11
2   7A  7B
1    6

Tables must never become a simple list.

Each table displays:

* Table number
* Active order count
* Status indicator

---

# Room Management

Each table can contain multiple rooms/orders.

Examples:

Table 7A

* Room 110
* Room 112
* Outside Guest

Supported actions:

* Create room/order
* Rename room
* Delete room

Deleting a room requires confirmation.

---

# Menu Database

Menu is generated entirely from the database.

No hardcoded menu items.

Database fields:

* name
* id
* zones
* category
* subcategory
* active
* sort
* applies_to
* note

Only active database items are displayed.

---

# Menu Hierarchy

## Level 1

Food
Drink Menu
Dessert

Displayed vertically.

---

## Food

Subcategories:

* Main Courses
* Burgers
* Pinsa
* Sides
* Fries
* Kid Menu

---

## Drink Menu

Subcategories:

* Draft Beer
* Can Beer
* Red Wine
* White Wine
* Soda
* Water
* Spirit
* Extras

---

## Dessert

Subcategories:

* Ice Cream
* Desserts

---

# New Order Screen

No customer selection screen.

Instead:

Room / Guest field

Examples:

110
215
Outside
Outside Guest

---

# New Order Layout

Two columns.

## Left Side

Category
→ Subcategory
→ Items

Generated from database.

---

## Right Side

Live Ticket Preview

Always visible.

Updates immediately.

Displays:

* Table
* Room
* Items
* Extras
* Notes

---

# Item Notes

Food items support item-level notes.

Examples:

* No sauce
* Gluten free
* No lettuce
* Extra crispy

Notes belong to the specific item.

Not to the entire order.

---

# Burger Extras

Available:

* Extra Bacon
* Extra Egg
* Extra Mayonnaise

Workflow:

Select Burger

↓

Show Extras

↓

Attach Extras

Example:

Regular Burger

* Extra Bacon
* Extra Egg

Extras are not separate order rows.

---

# Save Order

Saving creates an operational order.

Routing is automatic.

---

# Kitchen Routing

Kitchen receives only kitchen-zone items.

Examples:

* Main Courses
* Burgers
* Pinsa
* Fries
* Kid Menu

Kitchen never receives:

* Beer
* Wine
* Soda
* Spirits
* Water

---

# Kitchen Ticket Merging

Kitchen works per table.

Not per saved order.

Example:

Table 7A

Order 1:
1x Meat of the Day

Order 2:
2x Fish of the Day

Kitchen displays:

TABLE 7A

1x Meat of the Day
2x Fish of the Day

Single merged ticket.

New food items are appended.

No duplicate table tickets.

---

# Kitchen Statuses

NEW
IN PREP
RDY
DONE

---

# Kitchen Completion

Completed tickets remain visible.

Visual state:

* Grey
* Semi-transparent
* Readable

Completed tickets do not count as active.

New items added later appear in the active section of the same ticket.

---

# Bar Quick Overview

Purpose:

Fast bartender queue.

Displays:

* Newest orders first
* Scrollable list
* Item completion states
* Order completion states
* Notes

Food:
normal appearance

Drinks:
visually emphasized

Desserts:
visually emphasized

Spacing between sections:

* Food
* Drinks
* Desserts

---

# Bar Item Completion

Click item:

Active
→ Completed

Completed items:

Green

Click again:

Completed
→ Active

---

# Bar Order Completion

OK button:

Active Order
→ Grey Completed Order

Order remains visible.

Click again restores active state.

---

# Reception View

Purpose:

Operational cash register helper.

Displays:

* Table
* Room
* Complete order
* Notes
* Current operational history

Reception does not manage kitchen workflow.

---

# Notifications

Examples:

* Order Saved
* Order Updated
* Undo Available

Behaviour:

* Display
* Auto-hide after 3 seconds

---

# Data Retention

Brunholl Orders is operational only.

Planned behaviour:

Orders visible during service.

Daily cleanup around 06:00.

Permanent history is stored in the cash register system.

---

# Future Firebase Integration

Collections:

* orders
* tables
* menu
* settings

Requirements:

* Real-time updates
* Multi-device synchronization
* Kitchen updates instantly
* Bar updates instantly
* Reception updates instantly

---

# Future Features

* Menu images
* Better filtering
* Additional categories
* Advanced statistics

These are lower priority than workflow and synchronization.

---

# Current Development Priority

1. Finish Beta UX
2. Kitchen ticket merging
3. Room management
4. Firebase integration
5. Online deployment
6. Daily cleanup logic
