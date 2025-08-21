// Wiki-RAG Frontend Application
class WikiRAGApp {
  constructor () {
    this.token = localStorage.getItem('confluenceToken') || '';
    this.selectedSpace = null;
    this.pages = new Map(); // pageId -> page data
    this.selectedPages = new Set();
    this.indexedPages = new Set();
    this.currentPreviewPage = null;
    // Indentation per level in the page tree (px)
    this.indentPerLevel = 22;

    this.initializeElements();
    this.attachEventListeners();
    this.initializeApp();
    this.startStatusPolling();
  }

  initializeElements () {
    // Form elements
    this.tokenInput = document.getElementById('confluence-token');
    this.spaceSelect = document.getElementById('space-select');
    this.pageTree = document.getElementById('page-tree');
    this.pageTreeItems = document.getElementById('page-tree-items');
    this.pagePreview = document.getElementById('page-preview-content');

    // Buttons
    this.loadSpacesBtn = document.getElementById('load-spaces-btn');
    this.selectAllBtn = document.getElementById('select-all-btn');
    this.deselectAllBtn = document.getElementById('deselect-all-btn');
    this.indexSelectedBtn = document.getElementById('index-selected-btn');
    this.indexDescendantsBtn = document.getElementById('index-descendants-btn');
    this.removeIndexBtn = document.getElementById('remove-index-btn');
    this.searchBtn = document.getElementById('search-btn');
    this.expandAllBtn = document.getElementById('expand-all-btn');

    // Search elements
    this.searchQuery = document.getElementById('search-query');
    this.searchThreshold = document.getElementById('search-threshold');
    this.searchLimit = document.getElementById('search-limit');
    this.searchResults = document.getElementById('search-results');

    // Status elements
    this.statusQueued = document.getElementById('status-queued');
    this.statusProcessing = document.getElementById('status-processing');
    this.statusCompleted = document.getElementById('status-completed');
    this.statusErrors = document.getElementById('status-errors');

    // Progress elements
    this.indexingProgress = document.getElementById('indexing-progress');
    this.progressFill = document.getElementById('progress-fill');

    // Alerts container
    this.alertsContainer = document.getElementById('alerts-container');

    // Token modal elements
    this.tokenModal = document.getElementById('token-modal');
    this.tokenModalInput = document.getElementById('token-modal-input');
    this.tokenModalSave = document.getElementById('token-modal-save');
    this.tokenModalCancel = document.getElementById('token-modal-cancel');
    this.tokenIconBtn = document.getElementById('token-icon-btn');
  }

  attachEventListeners () {
    // Token input
    this.tokenInput.addEventListener('input', (e) => {
      this.token = e.target.value.trim();
      localStorage.setItem('confluenceToken', this.token);
    });

    // Space selection
    this.spaceSelect.addEventListener('change', (e) => {
      this.selectedSpace = e.target.value;
      if (this.selectedSpace) {
        this.loadPages();
      }
    });

    // Button events
    this.loadSpacesBtn.addEventListener('click', () => {
      if (!this.token) {
        this.pendingLoadSpaces = true;
        this.showTokenDialog();
        return;
      }
      this.loadSpaces();
    });
    this.selectAllBtn.addEventListener('click', () => this.selectAllPages());
    this.deselectAllBtn.addEventListener('click', () => this.deselectAllPages());
    this.indexSelectedBtn.addEventListener('click', () => this.indexSelectedPages());
    this.indexDescendantsBtn.addEventListener('click', () => this.indexDescendants());
    this.removeIndexBtn.addEventListener('click', () => this.removeSelectedIndex());
    this.searchBtn.addEventListener('click', () => this.performSearch());
    if (this.expandAllBtn) {
      this.expandAllBtn.addEventListener('click', () => this.expandEntireTree());
    }

    // Token modal events
    if (this.tokenIconBtn) {
      this.tokenIconBtn.addEventListener('click', () => this.showTokenDialog());
    }
    if (this.tokenModalSave) {
      this.tokenModalSave.addEventListener('click', () => this.saveTokenFromDialog());
    }
    if (this.tokenModalCancel) {
      this.tokenModalCancel.addEventListener('click', () => this.hideTokenDialog());
    }
    if (this.tokenModalInput) {
      this.tokenModalInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.saveTokenFromDialog();
        }
      });
    }

    // Search on Enter
    this.searchQuery.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });
    // Persist RAG search input text
    this.searchQuery.addEventListener('input', () => {
      try { localStorage.setItem('ragSearchQuery', this.searchQuery.value); } catch (_) {}
    });
  }

  initializeApp () {
    // Set token from localStorage
    if (this.token) {
      this.tokenInput.value = this.token;
    }

    // Restore RAG search input text
    try {
      const savedQuery = localStorage.getItem('ragSearchQuery');
      if (savedQuery) {
        this.searchQuery.value = savedQuery;
      }
    } catch (_) {}

    // Auto-load spaces on page load
    if (this.token) {
      // If token already known, load spaces immediately
      this.loadSpaces();
    } else {
      // Prompt for token and auto-load after saving
      this.pendingLoadSpaces = true;
      this.showTokenDialog();
    }
  }

  // Token modal helpers
  showTokenDialog () {
    if (!this.tokenModal) return;
    // Prefill from stored token
    if (this.tokenModalInput) {
      this.tokenModalInput.value = this.token || '';
    }
    this.tokenModal.classList.remove('hidden');
    // Focus after render
    setTimeout(() => { this.tokenModalInput && this.tokenModalInput.focus(); }, 0);
  }

  hideTokenDialog () {
    if (!this.tokenModal) return;
    this.tokenModal.classList.add('hidden');
    this.pendingLoadSpaces = false;
  }

  saveTokenFromDialog () {
    if (!this.tokenModalInput) return;
    const value = this.tokenModalInput.value.trim();
    this.token = value;
    localStorage.setItem('confluenceToken', this.token);
    if (this.tokenInput) {
      this.tokenInput.value = this.token;
    }
    this.hideTokenDialog();
    if (this.pendingLoadSpaces && this.token) {
      const shouldLoad = true;
      this.pendingLoadSpaces = false;
      if (shouldLoad) {
        this.loadSpaces();
      }
    }
  }

  // API Helper Methods
  async makeRequest (url, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Network error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // UI Helper Methods
  showAlert (message, type = 'success') {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;

    this.alertsContainer.appendChild(alert);

    setTimeout(() => {
      alert.remove();
    }, 5000);
  }

  setLoading (element, loading = true) {
    const loadingSpinner = element.querySelector('.loading');
    const textSpan = element.querySelector('span');

    if (loadingSpinner) {
      loadingSpinner.classList.toggle('hidden', !loading);
    }

    element.disabled = loading;
  }

  updateProgress (progress) {
    if (progress === 0) {
      this.indexingProgress.classList.add('hidden');
    } else {
      this.indexingProgress.classList.remove('hidden');
      this.progressFill.style.width = `${progress}%`;
    }
  }

  // Core Functionality
  async loadSpaces () {
    if (!this.token) {
      this.showAlert('Please enter a Confluence token first', 'error');
      return;
    }

    this.setLoading(this.loadSpacesBtn, true);

    try {
      const spaces = await this.makeRequest('/api/wiki/spaces');

      // Clear and populate space select
      this.spaceSelect.innerHTML = '<option value="">Select a space...</option>';

      spaces.forEach(space => {
        const option = document.createElement('option');
        option.value = space.key;
        option.textContent = `${space.name} (${space.key})`;
        this.spaceSelect.appendChild(option);
      });

      this.spaceSelect.disabled = false;
      this.showAlert(`Loaded ${spaces.length} spaces successfully`);

    } catch (error) {
      console.error('Error loading spaces:', error);
      this.showAlert(`Failed to load spaces: ${error.message}`, 'error');
    } finally {
      this.setLoading(this.loadSpacesBtn, false);
    }
  }

  async loadPages () {
    if (!this.selectedSpace) return;

    if (this.pageTreeItems) {
      this.pageTreeItems.innerHTML = '<div style="text-align: center; padding: 1rem;">Loading pages...</div>';
    }
    if (this.expandAllBtn) {
      this.expandAllBtn.classList.add('hidden');
      this.expandAllBtn.disabled = true;
    }

    try {
      const pages = await this.makeRequest(`/api/wiki/pages?spaceKey=${this.selectedSpace}`);

      // Store pages data
      pages.forEach(page => {
        this.pages.set(page.id, page);
      });

      // Check which pages are already indexed
      const pageIds = pages.map(p => p.id);
      const indexedIds = await this.makeRequest('/api/indexed-ids', {
        method: 'POST',
        body: JSON.stringify({ ids: pageIds }),
      });

      this.indexedPages = new Set(indexedIds);

      // Render page tree
      this.renderPageTree(pages);

      // Enable action buttons
      this.selectAllBtn.disabled = false;
      this.deselectAllBtn.disabled = false;
      if (this.expandAllBtn) {
        // Show Expand All only if there are pages and at least one has children (i.e., there is a second level)
        const showExpand = Array.isArray(pages) && pages.length > 0 && pages.some(p => p && p.hasChildren);
        this.expandAllBtn.classList.toggle('hidden', !showExpand);
        this.expandAllBtn.disabled = !showExpand;
      }

      this.showAlert(`Loaded ${pages.length} pages successfully`);

    } catch (error) {
      console.error('Error loading pages:', error);
      this.showAlert(`Failed to load pages: ${error.message}`, 'error');
      if (this.pageTreeItems) {
        this.pageTreeItems.innerHTML = '<div style="text-align: center; color: red; padding: 2rem;">Failed to load pages</div>';
      }
    }
  }

  renderPageTree (pages, parentElement = null) {
    const container = parentElement || this.pageTreeItems || this.pageTree;

    if (!parentElement) {
      container.innerHTML = '';
    }

    pages.forEach(page => {
      const item = this.createTreeItem(page);
      container.appendChild(item);
    });
  }

  createTreeItem (page, level = 0) {
    const isIndexed = this.indexedPages.has(page.id);
    const item = document.createElement('div');
    item.className = 'tree-item';
    // store level and apply visual indentation to clearly show hierarchy
    item.dataset.level = String(level);
    // Use !important to override CSS .tree-item margin shorthand with !important
    item.style.setProperty('margin-left', `${level * this.indentPerLevel - (isIndexed ? 4 : 0)}px`, 'important');
    item.dataset.pageId = page.id;

    if (isIndexed) {
      item.classList.add('indexed');
    }

    // Toggle button for children
    const toggle = document.createElement('button');
    toggle.className = page.hasChildren ? 'tree-toggle' : 'tree-toggle-d';
    toggle.innerHTML = page.hasChildren ? '▶' : '　';
    toggle.disabled = !page.hasChildren;

    if (page.hasChildren) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        this.togglePageChildren(page.id, toggle);
      });
      // Double-click on the expand icon expands all descendants recursively
      toggle.addEventListener('dblclick', async (e) => {
        e.stopPropagation();
        try {
          await this.expandAllDescendants(page.id, toggle);
        } catch (err) {
          console.error('Error expanding all descendants:', err);
        }
      });
    }

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-checkbox';
    checkbox.checked = this.selectedPages.has(page.id);
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (e.target.checked) {
        this.selectedPages.add(page.id);
      } else {
        this.selectedPages.delete(page.id);
      }
      this.updateActionButtons();
    });

    // Page title
    const title = document.createElement('span');
    title.textContent = page.title;
    title.style.flex = '1';
    title.addEventListener('click', () => {
      this.selectPage(page.id);
      this.loadPagePreview(page.id);
    });

    item.appendChild(toggle);
    item.appendChild(checkbox);
    item.appendChild(title);

    return item;
  }

  // Expand the specified node and all its descendants recursively
  async expandAllDescendants (pageId, toggleButton) {
    // Ensure the current node is expanded
    if (toggleButton && toggleButton.innerHTML !== '▼') {
      await this.togglePageChildren(pageId, toggleButton);
    }

    // After expansion, the immediate children container should be the next sibling
    const parentItem = toggleButton ? toggleButton.parentElement : null;
    let childrenContainer = null;
    if (parentItem) {
      const next = parentItem.nextElementSibling;
      if (next && next.classList && next.classList.contains('tree-children')) {
        childrenContainer = next;
      }
    }

    if (!childrenContainer) return;

    // For each immediate child, expand if it has its own children
    const childItems = Array.from(childrenContainer.children).filter(el => el.classList && el.classList.contains('tree-item'));
    for (const childItem of childItems) {
      const childToggle = childItem.querySelector('button.tree-toggle');
      if (!childToggle) continue; // no children
      const childPageId = childItem.dataset.pageId;
      // Recursively expand this child and its descendants
      await this.expandAllDescendants(childPageId, childToggle);
    }
  }

  async expandEntireTree () {
    if (!this.pageTreeItems && !this.pageTree) return;
    if (this.expandAllBtn) this.setLoading(this.expandAllBtn, true);
    try {
      // Find all top-level items (direct children of items container)
      const container = this.pageTreeItems || this.pageTree;
      const rootItems = Array.from(container.children).filter(el => el.classList && el.classList.contains('tree-item'));
      for (const item of rootItems) {
        const toggle = item.querySelector('button.tree-toggle');
        if (toggle) {
          const pageId = item.dataset.pageId;
          await this.expandAllDescendants(pageId, toggle);
        }
      }
    } catch (e) {
      console.error('Failed to expand entire tree:', e);
      this.showAlert('Failed to expand entire tree', 'error');
    } finally {
      if (this.expandAllBtn) this.setLoading(this.expandAllBtn, false);
    }
  }

  async togglePageChildren (pageId, toggleButton) {
    const isExpanded = toggleButton.innerHTML === '▼';

    if (isExpanded) {
      // Collapse - remove children
      toggleButton.innerHTML = '▶';
      let sibling = toggleButton.parentElement.nextElementSibling;
      while (sibling && sibling.classList.contains('tree-children')) {
        const toRemove = sibling;
        sibling = sibling.nextElementSibling;
        toRemove.remove();
      }
    } else {
      // Expand - load children
      toggleButton.innerHTML = '▼';

      try {
        const children = await this.makeRequest(`/api/wiki/children?parentId=${pageId}`);

        // Store children data
        children.forEach(child => {
          this.pages.set(child.id, child);
        });

        // Check indexed status for children
        const childIds = children.map(c => c.id);
        if (childIds.length > 0) {
          const indexedIds = await this.makeRequest('/api/indexed-ids', {
            method: 'POST',
            body: JSON.stringify({ ids: childIds }),
          });

          indexedIds.forEach(id => this.indexedPages.add(id));
        }

        // Create children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'tree-children';

        // use explicit dataset level instead of parsing styles
        const parentLevel = parseInt(toggleButton.parentElement.dataset.level || '0', 10) || 0;

        children.forEach(child => {
          const childItem = this.createTreeItem(child, parentLevel + 1);
          childrenContainer.appendChild(childItem);
        });

        // Insert after parent item
        toggleButton.parentElement.parentNode.insertBefore(
          childrenContainer,
          toggleButton.parentElement.nextSibling,
        );

      } catch (error) {
        console.error('Error loading children:', error);
        this.showAlert(`Failed to load child pages: ${error.message}`, 'error');
        toggleButton.innerHTML = '▶';
      }
    }
  }

  selectPage (pageId) {
    // Remove previous selection
    const container = this.pageTreeItems || this.pageTree;
    const previousSelected = container.querySelector('.tree-item.selected');
    if (previousSelected) {
      previousSelected.classList.remove('selected');
    }

    // Add current selection
    const currentItem = container.querySelector(`[data-page-id="${pageId}"]`);
    if (currentItem) {
      currentItem.classList.add('selected');
    }

    this.currentPreviewPage = pageId;
  }

  async loadPagePreview (pageId) {
    this.pagePreview.innerHTML = '<div style="text-align: center; padding: 1rem;">Loading preview...</div>';

    try {
      const pageData = await this.makeRequest(`/api/wiki/page?id=${pageId}`);

      this.pagePreview.innerHTML = `
                <h3>${pageData.title}</h3>
                <div style="max-height: 300px; overflow-y: auto; border: 1px solid #eee; padding: 1rem; border-radius: 4px;">
                    ${pageData.html}
                </div>
            `;

    } catch (error) {
      console.error('Error loading page preview:', error);
      this.pagePreview.innerHTML = `<div style="color: red; text-align: center; padding: 2rem;">Failed to load preview: ${error.message}</div>`;
    }
  }

  selectAllPages () {
    const container = this.pageTreeItems || this.pageTree;
    const checkboxes = container.querySelectorAll('.tree-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = true;
      const pageId = checkbox.closest('.tree-item').dataset.pageId;
      this.selectedPages.add(pageId);
    });
    this.updateActionButtons();
  }

  deselectAllPages () {
    const container = this.pageTreeItems || this.pageTree;
    const checkboxes = container.querySelectorAll('.tree-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.checked = false;
      const pageId = checkbox.closest('.tree-item').dataset.pageId;
      this.selectedPages.delete(pageId);
    });
    this.updateActionButtons();
  }

  updateActionButtons () {
    const hasSelection = this.selectedPages.size > 0;
    this.indexSelectedBtn.disabled = !hasSelection;
    this.indexDescendantsBtn.disabled = !hasSelection;
    this.removeIndexBtn.disabled = !hasSelection;
  }

  async indexSelectedPages () {
    if (this.selectedPages.size === 0) {
      this.showAlert('Please select pages to index', 'warning');
      return;
    }

    this.setLoading(this.indexSelectedBtn, true);
    this.updateProgress(1);

    try {
      const selectedPageData = Array.from(this.selectedPages).map(id => {
        const page = this.pages.get(id);
        return {
          id: page.id,
          spaceKey: page.spaceKey || this.selectedSpace,
          title: page.title,
        };
      });

      const result = await this.makeRequest('/api/index', {
        method: 'POST',
        body: JSON.stringify({ pages: selectedPageData }),
      });

      this.showAlert(`Indexing started for ${selectedPageData.length} pages`);

      // Mark pages as being processed
      this.selectedPages.forEach(id => {
        this.indexedPages.add(id);
        const item = this.pageTree.querySelector(`[data-page-id="${id}"]`);
        if (item) {
          item.classList.add('indexed');
        }
      });

    } catch (error) {
      console.error('Error starting indexing:', error);
      this.showAlert(`Failed to start indexing: ${error.message}`, 'error');
      this.updateProgress(0);
    } finally {
      this.setLoading(this.indexSelectedBtn, false);
    }
  }

  async indexDescendants () {
    if (this.selectedPages.size === 0) {
      this.showAlert('Please select at least one page to index its descendants', 'warning');
      return;
    }

    const roots = Array.from(this.selectedPages).map(id => {
      const page = this.pages.get(id);
      return {
        id: page.id,
        spaceKey: page.spaceKey || this.selectedSpace,
        title: page.title,
      };
    });

    this.setLoading(this.indexDescendantsBtn, true);
    this.updateProgress(1);

    try {
      const result = await this.makeRequest('/api/index/descendants', {
        method: 'POST',
        body: JSON.stringify({ roots }),
      });

      const count = result.pagesCount ?? roots.length;
      this.showAlert(`Indexing descendants started (queued ${count} pages)`);

      // Mark the selected roots as indexed in UI immediately
      this.selectedPages.forEach(id => {
        this.indexedPages.add(id);
        const item = this.pageTree.querySelector(`[data-page-id="${id}"]`);
        if (item) item.classList.add('indexed');
      });

    } catch (error) {
      console.error('Error starting descendants indexing:', error);
      this.showAlert(`Failed to start indexing descendants: ${error.message}`, 'error');
      this.updateProgress(0);
    } finally {
      this.setLoading(this.indexDescendantsBtn, false);
    }
  }

  async removeSelectedIndex () {
    if (this.selectedPages.size === 0) {
      this.showAlert('Please select pages to deindex', 'warning');
      return;
    }

    const confirmed = confirm(`Are you sure you want to remove indexing for ${this.selectedPages.size} selected pages?`);
    if (!confirmed) return;

    try {
      const promises = Array.from(this.selectedPages).map(async pageId => {
        try {
          await this.makeRequest(`/api/index/${pageId}`, {
            method: 'DELETE',
          });

          this.indexedPages.delete(pageId);
          const item = this.pageTree.querySelector(`[data-page-id="${pageId}"]`);
          if (item) {
            item.classList.remove('indexed');
          }

          return { success: true, pageId };
        } catch (error) {
          return { success: false, pageId, error: error.message };
        }
      });

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      if (successful > 0) {
        this.showAlert(`Successfully removed indexing for ${successful} pages`);
      }
      if (failed > 0) {
        this.showAlert(`Failed to remove indexing for ${failed} pages`, 'error');
      }

    } catch (error) {
      console.error('Error removing index:', error);
      this.showAlert(`Failed to remove indexing: ${error.message}`, 'error');
    }
  }

  async performSearch () {
    const query = this.searchQuery.value.trim();
    if (!query) {
      this.showAlert('Please enter a search query', 'warning');
      return;
    }

    const threshold = parseFloat(this.searchThreshold.value);
    const limit = parseInt(this.searchLimit.value);

    this.setLoading(this.searchBtn, true);
    this.searchResults.innerHTML = '<div style="text-align: center; padding: 1rem;">Searching...</div>';

    try {
      const results = await this.makeRequest('/api/rag/search', {
        method: 'POST',
        body: JSON.stringify({
          query,
          threshold,
          chunksLimit: limit,
        }),
      });

      this.displaySearchResults(results);

    } catch (error) {
      console.error('Error performing search:', error);
      this.showAlert(`Search failed: ${error.message}`, 'error');
      this.searchResults.innerHTML = '<div style="color: red; text-align: center; padding: 2rem;">Search failed</div>';
    } finally {
      this.setLoading(this.searchBtn, false);
    }
  }

  displaySearchResults (results) {
    if (!results.results || results.results.length === 0) {
      this.searchResults.innerHTML = '<div style="text-align: center; color: #666; padding: 2rem;">No results found</div>';
      return;
    }

    const buildWikiUrl = (id) => {
      const base = (window.CONFLUENCE_BASE_URL || localStorage.getItem('CONFLUENCE_BASE_URL') || '').toString();
      const cleanBase = base.replace(/\/$/, '');
      if (cleanBase) return `${cleanBase}/pages/viewpage.action?pageId=${encodeURIComponent(id)}`;
      return `https://wiki.finam.ru/pages/viewpage.action?pageId=${encodeURIComponent(id)}`;
    };

    const resultsHtml = results.results.map(result => `
            <div class="search-result">
                <div class="similarity">${(result.similarity * 100).toFixed(1)}%</div>
                <div class="found-by" style="margin: 0.25rem 0; color: #444; font-size: 0.9rem;">
                  ${result.question ? `Найдено по вопросу: <b>${result.question}</b>` : 'Найдено по тексту чанка'}
                </div>
                <h4>Wiki ID: <a href="${buildWikiUrl(result.wiki_id)}" target="_blank" rel="noopener noreferrer">${result.wiki_id}</a> Chunk ID: ${result.chunk_id}</h4>
                <details class="chunk-details">
                  <summary style="cursor: pointer; user-select: none; color: #0d6efd;">Показать содержимое</summary>
                  <div style="white-space: pre-wrap; font-family: monospace; background: #f8f9fa; padding: 0.5rem; border-radius: 4px; font-size: 0.9rem; margin-top: 0.5rem;">
                    ${result.chunk}
                  </div>
                </details>
            </div>
        `).join('');

    const statsHtml = `
            <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.9rem;">
                <strong>Search Results:</strong> ${results.total_results} results found
                ${results.processing_time_ms ? ` | Processing time: ${results.processing_time_ms}ms` : ''}
                ${results.tokens_used ? ` | Tokens: ${results.tokens_used}` : ''}
                ${results.estimated_cost ? ` | Cost: $${results.estimated_cost.toFixed(6)}` : ''}
            </div>
        `;

    this.searchResults.innerHTML = statsHtml + resultsHtml;
  }

  async updateStatus () {
    try {
      const status = await this.makeRequest('/api/status');

      this.statusQueued.textContent = status.queued || 0;
      this.statusProcessing.textContent = status.processing || 0;
      this.statusCompleted.textContent = status.completed || 0;
      this.statusErrors.textContent = status.errors || 0;

      // Update progress bar based on processing status
      const total = (status.queued || 0) + (status.processing || 0) + (status.completed || 0) + (status.errors || 0);
      if (total > 0) {
        const progress = ((status.completed || 0) + (status.errors || 0)) / total * 100;
        this.updateProgress(progress);

        if (progress >= 100) {
          setTimeout(() => this.updateProgress(0), 2000);
        }
      }

    } catch (error) {
      // Silently fail status updates
      console.debug('Status update failed:', error.message);
    }
  }

  startStatusPolling () {
    // Update status immediately
    this.updateStatus();

    // Then update every 5 seconds
    setInterval(() => {
      this.updateStatus();
    }, 5000);
  }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.wikiRAGApp = new WikiRAGApp();
});

// Export for potential module use
export default WikiRAGApp;
