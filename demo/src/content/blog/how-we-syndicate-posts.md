---
title: How We Syndicate Posts to dev.to
slug: how-we-syndicate-posts
syndicate: true
coverImage: /covers/markdown-post-cover.png
description: >-
  A walk-through of the build-time pipeline that pushes this blog's posts to
  dev.to as drafts.
series: Building astro-syndicate
tags:
  - astro
  - devto
  - automation
---

Every time we run `astro build`, an Astro integration scans this content
directory, hashes each post, and pushes anything that changed to dev.to.
Nothing goes live automatically: every post lands there as a draft.

## Architecture

![architecture diagram](/images/architecture.png "Sync pipeline overview")

The pipeline has three stages: read frontmatter, resolve local images to
public URLs, then diff against the hash stored from the last sync.

<img src="/images/screenshot.png" alt="Build log showing a created draft">

## Why hashing matters

> Re-running the build on an unchanged post costs zero API calls. The hash
> comparison happens before any network request.

An example of the frontmatter block this integration writes back, shown here
as a code sample so it must **not** be treated as a real image reference:

```md
![this is just an example, not a real image](/images/not-a-real-file.png)
```

And inline, for good measure: `![also not real](/images/also-not-real.png)`
should stay exactly as written too.

## What gets sent

| Field | Source |
| --- | --- |
| `title` | frontmatter `title` |
| `body_markdown` | this file, with local images rewritten |
| `canonical_url` | `site` + `/blog/${slug}/` |
| `main_image` | `coverImage`, resolved to an absolute URL |
| `description` | frontmatter `description` |
| `tags` | frontmatter `tags`, capped at 4 |

That's the whole contract.
