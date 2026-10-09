/*
 * Utilitaires partagés des portails web Pharma Connect.
 *
 * Les deux portails portaient chacun sa copie de ces fonctions — client API, échappement
 * HTML, notification éphémère, formatage de date. Les copies avaient déjà divergé sur la
 * gestion du 401. Elles vivent désormais ici.
 *
 * Chargé en script classique (pas en module) : les portails sont servis en fichiers
 * statiques, parfois depuis le disque, où les modules ES se heurtent aux règles d'origine.
 */

/* global window, document */

(function (global) {
  'use strict';

  var PharmaWeb = {};

  /**
   * Clé de stockage du jeton, propre à chaque portail.
   *
   * Volontairement **pas** partagée : les deux portails peuvent être servis depuis la
   * même origine, et une clé commune ferait qu'un jeton d'administrateur serait présenté
   * par l'espace pharmacien, ou l'inverse — avec à la clé un 403 incompréhensible à
   * chaque chargement. Chaque portail déclare la sienne au démarrage.
   */
  var tokenKey = 'pharma_connect_token';

  /** À appeler une fois, avant tout appel API. */
  PharmaWeb.configure = function (options) {
    if (options && options.tokenKey) tokenKey = options.tokenKey;
  };

  // --- Jeton -----------------------------------------------------------------------

  PharmaWeb.getToken = function () {
    try {
      return global.localStorage.getItem(tokenKey);
    } catch (error) {
      // Navigation privée ou stockage bloqué : le portail reste utilisable, la session
      // ne survivra simplement pas au rechargement.
      return null;
    }
  };

  PharmaWeb.setToken = function (token) {
    try {
      global.localStorage.setItem(tokenKey, token);
    } catch (error) {
      /* ignoré : voir getToken */
    }
  };

  PharmaWeb.clearToken = function () {
    try {
      global.localStorage.removeItem(tokenKey);
    } catch (error) {
      /* ignoré : voir getToken */
    }
  };

  // --- Client API ------------------------------------------------------------------

  /**
   * Erreur d'appel API, avec le code HTTP conservé.
   *
   * `isNetworkError` vaut `true` quand la requête n'a jamais atteint le serveur :
   * l'absence de code est le signal, exactement comme dans `ApiException` côté Flutter.
   * La distinction change le message affiché — une coupure réseau est corrigeable par
   * l'utilisateur, une erreur 500 non.
   */
  function ApiError(message, status) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || null;
    this.isNetworkError = !status;
  }
  ApiError.prototype = Object.create(Error.prototype);
  PharmaWeb.ApiError = ApiError;

  /**
   * Crée un client API lié à une base d'URL.
   *
   * @param {string} baseUrl racine de l'API, sans barre oblique finale
   * @param {function} onUnauthorized appelé sur 401, pour déconnecter proprement
   */
  PharmaWeb.createClient = function (baseUrl, onUnauthorized) {
    return async function api(path, options) {
      options = options || {};
      var headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      var token = PharmaWeb.getToken();
      if (token) headers.Authorization = 'Bearer ' + token;

      var response;
      try {
        response = await fetch(baseUrl + path, Object.assign({}, options, { headers: headers }));
      } catch (error) {
        throw new ApiError('Serveur injoignable. Vérifiez votre connexion.', null);
      }

      if (response.status === 401) {
        if (typeof onUnauthorized === 'function') onUnauthorized();
        throw new ApiError('Session expirée, reconnectez-vous.', 401);
      }

      // 204 No Content : `response.json()` lèverait sur un corps vide.
      if (response.status === 204) return null;

      var payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (!response.ok) {
        var message =
          (payload && (payload.message || payload.error)) || 'Erreur ' + response.status;
        // NestJS renvoie parfois un tableau de messages de validation.
        if (Array.isArray(message)) message = message.join(' · ');
        throw new ApiError(message, response.status);
      }

      return payload;
    };
  };

  // --- Notification éphémère -------------------------------------------------------

  var toastTimer = null;

  /**
   * Affiche une notification en bas d'écran.
   *
   * @param {string} message
   * @param {'success'|'error'|null} tone
   */
  PharmaWeb.toast = function (message, tone) {
    var element = document.getElementById('toast');
    if (!element) return;

    element.textContent = message;
    element.className = 'toast show' + (tone ? ' toast-' + tone : '');

    // L'affichage est prolongé si une nouvelle notification arrive : sans ce
    // réarmement, la seconde hérite du minuteur de la première et disparaît trop tôt.
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      element.className = 'toast';
    }, tone === 'error' ? 4800 : 3200);
  };

  // --- Formatage -------------------------------------------------------------------

  PharmaWeb.escapeHtml = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  var dateTimeFormat = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  var dateFormat = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  PharmaWeb.formatDateTime = function (isoString) {
    if (!isoString) return '—';
    var date = new Date(isoString);
    return isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
  };

  PharmaWeb.formatDate = function (isoString) {
    if (!isoString) return '—';
    var date = new Date(isoString);
    return isNaN(date.getTime()) ? '—' : dateFormat.format(date);
  };

  var numberFormat = new Intl.NumberFormat('fr-FR');

  PharmaWeb.formatPrice = function (amountFcfa) {
    return numberFormat.format(Math.round(amountFcfa || 0)) + ' FCFA';
  };

  /** Abrège un nombre pour une tuile d'indicateur : 1 284 → 1,3 k. */
  PharmaWeb.compactNumber = function (value) {
    var absolute = Math.abs(value || 0);
    if (absolute >= 1e6) return trim(value / 1e6) + ' M';
    if (absolute >= 1e3) return trim(value / 1e3) + ' k';
    return String(Math.round(value || 0));
  };

  function trim(value) {
    return value
      .toFixed(Math.abs(value) < 10 ? 1 : 0)
      .replace('.', ',')
      .replace(/,0$/, '');
  }

  // --- Tableau triable et paginé ---------------------------------------------------

  /**
   * Rend un tableau triable et paginé.
   *
   * Le tri et la pagination restent en mémoire et ne touchent pas au serveur : les
   * volumes de ces portails — quelques dizaines de comptes, quelques centaines de lignes
   * de stock — tiennent en une requête, et une pagination serveur ajouterait un
   * aller-retour par clic sans rien gagner. À partir de quelques milliers de lignes, c'est
   * ce choix qu'il faudrait revoir, pas l'interface.
   *
   * Les en-têtes triables sont les `<th data-sort="clé">` du tableau. `aria-sort` est
   * tenu à jour, ce qui annonce l'ordre actif à un lecteur d'écran autant qu'il dessine
   * la flèche en CSS.
   *
   * @param {object} config
   * @param {HTMLElement} config.table            le tableau
   * @param {HTMLElement} config.body             le `<tbody>` à remplir
   * @param {HTMLElement} [config.paginationHost] conteneur de la pagination
   * @param {function} config.renderRow           (ligne) → chaîne HTML d'un `<tr>`
   * @param {object} [config.accessors]           clé de tri → (ligne) → valeur comparable
   * @param {number} [config.pageSize]            défaut 20
   * @param {HTMLElement} [config.emptyHost]      bloc d'état vide à montrer/cacher
   */
  PharmaWeb.createTable = function (config) {
    var pageSize = config.pageSize || 20;
    var accessors = config.accessors || {};
    var rows = [];
    var sortKey = null;
    var sortAscending = true;
    var page = 1;

    function valueOf(row, key) {
      var accessor = accessors[key];
      return accessor ? accessor(row) : row[key];
    }

    function sorted() {
      if (!sortKey) return rows;
      var copy = rows.slice();
      copy.sort(function (a, b) {
        var left = valueOf(a, sortKey);
        var right = valueOf(b, sortKey);
        if (left === right) return 0;
        if (left === null || left === undefined) return 1;
        if (right === null || right === undefined) return -1;
        var result =
          typeof left === 'string' && typeof right === 'string'
            ? left.localeCompare(right, 'fr', { sensitivity: 'base' })
            : left > right
              ? 1
              : -1;
        return sortAscending ? result : -result;
      });
      return copy;
    }

    function renderPagination(total) {
      if (!config.paginationHost) return;
      var pageCount = Math.max(1, Math.ceil(total / pageSize));

      // Une seule page : la pagination n'apporte rien et occupe de la place.
      if (pageCount <= 1) {
        config.paginationHost.innerHTML = '';
        config.paginationHost.classList.add('hidden');
        return;
      }

      config.paginationHost.classList.remove('hidden');
      var first = (page - 1) * pageSize + 1;
      var last = Math.min(page * pageSize, total);
      config.paginationHost.innerHTML =
        '<span>' + first + '–' + last + ' sur ' + total + '</span>' +
        '<span class="pagination-controls">' +
        '<button class="page-btn" data-page="prev"' + (page === 1 ? ' disabled' : '') + '>‹</button>' +
        '<span>Page ' + page + ' / ' + pageCount + '</span>' +
        '<button class="page-btn" data-page="next"' + (page === pageCount ? ' disabled' : '') + '>›</button>' +
        '</span>';
    }

    function render() {
      var all = sorted();
      var pageCount = Math.max(1, Math.ceil(all.length / pageSize));
      // Un filtre qui réduit la liste peut rendre la page courante inexistante.
      if (page > pageCount) page = pageCount;

      var slice = all.slice((page - 1) * pageSize, page * pageSize);
      config.body.innerHTML = slice.map(config.renderRow).join('');

      if (config.emptyHost) {
        config.emptyHost.classList.toggle('hidden', all.length > 0);
      }
      if (config.table) {
        config.table.classList.toggle('hidden', all.length === 0);
      }
      renderPagination(all.length);
    }

    // Tri au clic sur un en-tête.
    if (config.table) {
      config.table.querySelectorAll('th[data-sort]').forEach(function (header) {
        header.addEventListener('click', function () {
          var key = header.getAttribute('data-sort');
          if (sortKey === key) {
            sortAscending = !sortAscending;
          } else {
            sortKey = key;
            sortAscending = true;
          }
          config.table.querySelectorAll('th[data-sort]').forEach(function (other) {
            other.removeAttribute('aria-sort');
          });
          header.setAttribute('aria-sort', sortAscending ? 'ascending' : 'descending');
          page = 1;
          render();
        });
      });
    }

    if (config.paginationHost) {
      config.paginationHost.addEventListener('click', function (event) {
        var button = event.target.closest('button[data-page]');
        if (!button || button.disabled) return;
        page += button.getAttribute('data-page') === 'next' ? 1 : -1;
        render();
        // Le tableau peut être plus haut que la fenêtre : sans ce recentrage,
        // changer de page laisse l'utilisateur au milieu des nouvelles lignes.
        if (config.table && config.table.scrollIntoView) {
          config.table.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }

    return {
      /** Remplace les données et revient en page 1. */
      setRows: function (nextRows) {
        rows = nextRows || [];
        page = 1;
        render();
      },
      /** Redessine sans toucher aux données (après un tri ou un filtre externe). */
      refresh: render,
      get rows() {
        return rows;
      },
    };
  };

  // --- Squelettes ------------------------------------------------------------------

  /** Lignes de squelette aux dimensions des vraies lignes du tableau. */
  PharmaWeb.tableSkeleton = function (columnCount, rowCount) {
    var rows = '';
    for (var r = 0; r < (rowCount || 5); r++) {
      var cells = '';
      for (var c = 0; c < columnCount; c++) {
        // Largeurs alternées : une grille de blocs identiques se lit comme un motif
        // décoratif, pas comme du contenu à venir.
        var width = [70, 45, 60, 85][(r + c) % 4];
        cells += '<td><div class="skeleton skeleton-text" style="width:' + width + '%"></div></td>';
      }
      rows += '<tr>' + cells + '</tr>';
    }
    return rows;
  };

  global.PharmaWeb = PharmaWeb;
})(window);
