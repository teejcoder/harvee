---
layout: home

hero:
  name: harvest-clone
  text: Time tracking and invoicing
  tagline: A single-user tool for tracking billable hours and generating PDF invoices.

features:
  - title: Architecture
    details: State machines, data model, and how the pieces fit together.
    link: /architecture/overview
  - title: Guides
    details: How to run locally, generate an invoice, and edit time entries.
    link: /guides/running-locally
  - title: Decisions
    details: ADR-style notes on material design decisions.
    link: /decisions/
  - title: Changelog
    details: What has shipped, in Keep-a-Changelog format.
    link: /changelog
---

## What this is

A personal tool for a single contract developer to track time against clients, projects, and tasks, then generate a PDF invoice from that time. See the [product overview](https://github.com/) in `.memory/overview.md` for the full description.

## What this is not

Not a general-purpose invoicing platform. No multi-user, no auth, no expense tracking. See `.memory/tech-stack.md` for the "deliberately NOT" list.
