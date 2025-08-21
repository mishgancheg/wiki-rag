import * as cheerio from 'cheerio';

export interface CleanHtmlOptions {
  keepImages?: boolean;
  maxNestingLevel?: number;
  linkTarget?: string;
  noMinify?: boolean;
}

/**
 * Clean HTML according to the specification rules:
 * - Remove scripts, styles, forms, hidden elements, metadata
 * - Remove decorative/service tags
 * - Remove all attributes except href on links
 * - Remove empty elements and excessive nesting
 * - Minify output
 */
export async function cleanHtml(html: string, options: CleanHtmlOptions = {}): Promise<string> {
  const {
    keepImages = false,
    maxNestingLevel = 10,
    linkTarget = '_blank',
    noMinify = false
  } = options;

  // Load HTML with cheerio
  const $ = cheerio.load(html, {
    xmlMode: false
  });

  // Step 1: Remove unwanted elements completely
  const elementsToRemove = [
    // Scripts and styles
    'script', 'noscript', 'style', 'link[rel="stylesheet"]',
    
    // Form elements
    'form', 'input', 'textarea', 'select', 'option', 'optgroup', 
    'label', 'fieldset', 'legend', 'datalist', 'output', 
    'progress', 'meter', 'button',
    
    // Metadata and document structure
    'head', 'meta', 'title', 'base', 'link', 'style', 'script', 'noscript',
    
    // Embedded content
    'object', 'embed', 'applet', 'iframe', 'frame', 'frameset', 'noframes',
    
    // Media (conditionally)
    'audio', 'video', 'source', 'track', 'canvas', 'svg', 'math',
    
    // Semantic elements that are decorative
    'footer', 'header', 'nav', 'font',
    
    // Specific div classes
    'div.footer', 'div.header'
  ];

  // Remove images unless explicitly kept
  if (!keepImages) {
    elementsToRemove.push('img', 'picture', 'figure', 'figcaption', 'svg');
  }

  elementsToRemove.forEach(selector => {
    $(selector).remove();
  });

  // Step 2: Remove hidden elements
  $('[hidden]').remove();
  $('[style*="display:none"], [style*="display: none"]').remove();
  $('[style*="visibility:hidden"], [style*="visibility: hidden"]').remove();

  // Step 3: Remove comments
  $.root().contents().filter(function() {
    return this.type === 'comment';
  }).remove();

  // Step 4: Remove title elements that might be in body
  $('body title').remove();

  // Step 5: Clean attributes - remove all except href on links
  $('*').each(function() {
    const element = $(this);
    const tagName = element.prop('tagName')?.toLowerCase();
    
    if (tagName === 'a') {
      // Keep only href attribute and add target
      const href = element.attr('href');
      // Remove all attributes by iterating through them
      const node = element.get(0) as any;
      const attributes = node?.attribs || {};
      Object.keys(attributes).forEach(attr => {
        element.removeAttr(attr);
      });
      if (href) {
        element.attr('href', href);
        if (linkTarget) {
          element.attr('target', linkTarget);
        }
      }
    } else {
      // Remove all attributes from other elements
      const node = element.get(0) as any;
      const attributes = node?.attribs || {};
      Object.keys(attributes).forEach(attr => {
        element.removeAttr(attr);
      });
    }
  });

  // Step 6: Normalize tag names
  $('strong, b').each(function() {
    const element = $(this);
    const content = element.html();
    element.replaceWith(`<b>${content}</b>`);
  });

  $('em, i').each(function() {
    const element = $(this);
    const content = element.html();
    element.replaceWith(`<i>${content}</i>`);
  });

  // Step 7: Remove excessive nesting and empty elements (multiple passes)
  for (let pass = 0; pass < 3; pass++) {
    // Remove empty elements
    $('*').each(function() {
      const element = $(this);
      const tagName = element.prop('tagName')?.toLowerCase();
      
      // Skip certain elements that can be empty by design
      if (['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tagName || '')) {
        return;
      }
      
      const text = element.text().trim();
      const hasContent = text.length > 0 || element.find('img, br, hr').length > 0;
      
      if (!hasContent) {
        element.remove();
      }
    });

    // Remove elements containing only a single self-closing element
    $('*').each(function() {
      const element = $(this);
      const children = element.children();
      const text = element.text().trim();
      
      if (text === '' && children.length === 1) {
        const childTag = children.first().prop('tagName')?.toLowerCase();
        if (['br', 'hr'].includes(childTag || '')) {
          element.remove();
        }
      }
    });

    // Unwrap redundant div/span elements
    $('div, span').each(function() {
      const element = $(this);
      const parent = element.parent();
      const children = element.children();
      
      // If div/span has no attributes and parent exists, consider unwrapping
      if (element.attr() === undefined || Object.keys(element.attr() || {}).length === 0) {
        // Don't unwrap if it would create invalid nesting
        const parentTag = parent.prop('tagName')?.toLowerCase();
        if (parentTag && !['p', 'span', 'i', 'b', 'em', 'strong'].includes(parentTag)) {
          const htmlContent = element.html();
          if (htmlContent) {
            element.replaceWith(htmlContent);
          }
        }
      }
    });

    // Handle excessive nesting
    $('*').each(function() {
      const element = $(this);
      const depth = getElementDepth(element);
      
      if (depth > maxNestingLevel) {
        // Convert deeply nested content to plain text
        const text = element.text().trim();
        if (text) {
          element.replaceWith(text);
        } else {
          element.remove();
        }
      }
    });
  }

  // Step 8: Remove <br> before closing block tags
  $('br').each(function() {
    const br = $(this);
    const next = br.next();
    
    if (next.length === 0 || isBlockElement(next.prop('tagName')?.toLowerCase() || '')) {
      br.remove();
    }
  });

  // Step 9: Clean up whitespace and get final HTML
  let cleanedHtml = $.html();

  // Step 10: Remove html/body wrapper if present
  cleanedHtml = cleanedHtml.replace(/^<html[^>]*><body[^>]*>/, '');
  cleanedHtml = cleanedHtml.replace(/<\/body><\/html>$/, '');

  // Step 11: Minify HTML (unless disabled)
  if (!noMinify) {
    cleanedHtml = minifyHtml(cleanedHtml);
  }

  // Step 12: Handle meta refresh tags (show warning and remove)
  if (cleanedHtml.includes('http-equiv="refresh"') || cleanedHtml.includes("http-equiv='refresh'")) {
    console.warn('[HTML Cleaner] Warning: Meta refresh tag found and removed');
    cleanedHtml = cleanedHtml.replace(/<meta[^>]*http-equiv=["']refresh["'][^>]*>/gi, '');
  }

  return cleanedHtml.trim();
}

// Helper function to calculate element depth
function getElementDepth(element: cheerio.Cheerio<any>): number {
  let depth = 0;
  let current = element.parent();
  
  while (current.length > 0 && current.prop('tagName')) {
    depth++;
    current = current.parent();
  }
  
  return depth;
}

// Helper function to check if element is block-level
function isBlockElement(tagName: string): boolean {
  const blockElements = [
    'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'table',
    'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    'article', 'section', 'aside', 'header', 'footer',
    'main', 'nav', 'figure', 'figcaption'
  ];
  
  return blockElements.includes(tagName.toLowerCase());
}

// Helper function to minify HTML
function minifyHtml(html: string): string {
  return html
    // Remove multiple spaces
    .replace(/\s+/g, ' ')
    // Remove spaces around tags
    .replace(/>\s+</g, '><')
    // Remove leading/trailing spaces
    .replace(/^\s+|\s+$/g, '')
    // Remove empty attributes
    .replace(/\s*=\s*["']["']/g, '')
    // Remove spaces before self-closing tags
    .replace(/\s+\/>/g, '/>')
    // Normalize quotes
    .replace(/=\s*'/g, '="')
    .replace(/'(\s|>)/g, '"$1');
}

// Test function for development
export async function testCleanHtml(): Promise<void> {
  const testHtml = `
    <html>
      <head>
        <title>Test</title>
        <style>body { color: red; }</style>
        <script>alert('test');</script>
      </head>
      <body>
        <div class="header">Header</div>
        <div style="display:none;">Hidden content</div>
        <p>This is a <strong>test</strong> with <em>formatting</em>.</p>
        <div>
          <div>
            <div>
              <span>Nested content</span>
            </div>
          </div>
        </div>
        <img src="/image.jpg" alt="Test image">
        <a href="/link" class="test-class" id="test-id">Test link</a>
        <div></div>
        <p><br></p>
        <form><input type="text"></form>
        <script>more script</script>
        <!-- Comment -->
        <footer>Footer content</footer>
      </body>
    </html>
  `;

  console.log('Original HTML:');
  console.log(testHtml);
  console.log('\n' + '='.repeat(50) + '\n');

  const cleaned = await cleanHtml(testHtml, { keepImages: false });
  console.log('Cleaned HTML:');
  console.log(cleaned);

  const cleanedWithImages = await cleanHtml(testHtml, { keepImages: true });
  console.log('\n' + '='.repeat(50) + '\n');
  console.log('Cleaned HTML (with images):');
  console.log(cleanedWithImages);
}

// Run test if this file is executed directly
if (require.main === module) {
  testCleanHtml().catch(console.error);
}