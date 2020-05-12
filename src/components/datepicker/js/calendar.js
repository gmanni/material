(function() {
  'use strict';

  /**
   * @ngdoc directive
   * @name mdCalendar
   * @module material.components.datepicker
   *
   * @param {Date} ng-model The component's model. Should be a Date object.
   * @param {Object=} ng-model-options Allows tuning of the way in which `ng-model` is being
   *  updated. Also allows for a timezone to be specified.
   *  <a href="https://docs.angularjs.org/api/ng/directive/ngModelOptions#usage">Read more at the
   *  ngModelOptions docs.</a>
   * @param {Date=} md-min-date Expression representing the minimum date.
   * @param {Date=} md-max-date Expression representing the maximum date.
   * @param {(function(Date): boolean)=} md-date-filter Function expecting a date and returning a
   *  boolean whether it can be selected or not.
   * @param {String=} md-current-view Current view of the calendar. Can be either "month" or "year".
   * @param {String=} md-mode Restricts the user to only selecting a value from a particular view.
   *  This option can be used if the user is only supposed to choose from a certain date type
   *  (e.g. only selecting the month). Can be either "month" or "day". **Note** that this will
   *  overwrite the `md-current-view` value.
   *
   * @description
   * `<md-calendar>` is a component that renders a calendar that can be used to select a date.
   * It is a part of the `<md-datepicker>` pane, however it can also be used on it's own.
   *
   * @usage
   *
   * <hljs lang="html">
   *   <md-calendar ng-model="birthday"></md-calendar>
   * </hljs>
   */
  angular.module('material.components.datepicker')
    .directive('mdCalendar', calendarDirective);

  // POST RELEASE
  // TODO(jelbourn): Mac Cmd + left / right == Home / End
  // TODO(jelbourn): Refactor month element creation to use cloneNode (performance).
  // TODO(jelbourn): Define virtual scrolling constants (compactness) users can override.
  // TODO(jelbourn): Animated month transition on ng-model change (virtual-repeat)
  // TODO(jelbourn): Scroll snapping (virtual repeat)
  // TODO(jelbourn): Remove superfluous row from short months (virtual-repeat)
  // TODO(jelbourn): Month headers stick to top when scrolling.
  // TODO(jelbourn): Previous month opacity is lowered when partially scrolled out of view.
  // TODO(jelbourn): Support md-calendar standalone on a page (as a tabstop w/ aria-live
  //     announcement and key handling).
  // TODO Read-only calendar (not just date-picker).

  function calendarDirective(inputDirective) {
    return {
      template: function(tElement, tAttr) {
        return '' +
          '<div ng-switch="calendarCtrl.currentView">' +
            '<md-calendar-year ng-switch-when="year"></md-calendar-year>' +
            '<md-calendar-month ng-switch-default></md-calendar-month>' +
          '</div>';
      },
      scope: {
        minDate: '=mdMinDate',
        maxDate: '=mdMaxDate',
        dateFilter: '=mdDateFilter',

        // These need to be prefixed, because Angular resets
        // any changes to the value due to bindToController.
        _mode: '@mdMode',
        _currentView: '@mdCurrentView'
      },
      require: ['ngModel', 'mdCalendar'],
      controller: CalendarCtrl,
      controllerAs: 'calendarCtrl',
      bindToController: true,
      link: function(scope, element, attrs, controllers) {
        var ngModelCtrl = controllers[0];
        var mdCalendarCtrl = controllers[1];
        mdCalendarCtrl.configureNgModel(ngModelCtrl, inputDirective);
      }
    };
  }

  /**
   * Occasionally the hideVerticalScrollbar method might read an element's
   * width as 0, because it hasn't been laid out yet. This value will be used
   * as a fallback, in order to prevent scenarios where the element's width
   * would otherwise have been set to 0. This value is the "usual" width of a
   * calendar within a floating calendar pane.
   */
  var FALLBACK_WIDTH = 340;

  /** Next identifier for calendar instance. */
  var nextUniqueId = 0;

  /** Maps the `md-mode` values to their corresponding calendar views. */
  var MODE_MAP = {
    day: 'month',
    month: 'year'
  };

  /**
   * Controller for the mdCalendar component.
   * @ngInject @constructor
   */
  function CalendarCtrl($element, $scope, $$mdDateUtil, $mdUtil,
    $mdConstant, $mdTheming, $$rAF, $attrs, $mdDateLocale, $filter) {

    $mdTheming($element);

    /**
     * @final
     * @type {!JQLite}
     */
    this.$element = $element;

    /**
     * @final
     * @type {!angular.Scope}
     */
    this.$scope = $scope;

    /**
     * @final
     * @type {!angular.$attrs} Current attributes object for the element
     */
    this.$attrs = $attrs;

    /** @final */
    this.dateUtil = $$mdDateUtil;

    /** @final */
    this.$mdUtil = $mdUtil;

    /** @final */
    this.keyCode = $mdConstant.KEY_CODE;

    /** @final */
    this.$$rAF = $$rAF;

    /** @final */
    this.$mdDateLocale = $mdDateLocale;

    /** @final The built-in Angular date filter. */
    this.ngDateFilter = $filter('date');

    /**
     * @final
     * @type {Date}
     */
    this.today = this.dateUtil.createDateAtMidnight();

    /** @type {!ngModel.NgModelController} */
    this.ngModelCtrl = null;

    /** @type {string} Class applied to the selected date cell. */
    this.SELECTED_DATE_CLASS = 'md-calendar-selected-date';

    /** @type {string} Class applied to the cell for today. */
    this.TODAY_CLASS = 'md-calendar-date-today';

    /** @type {string} Class applied to the focused cell. */
    this.FOCUSED_DATE_CLASS = 'md-focus';

    /** @final {number} Unique ID for this calendar instance. */
    this.id = nextUniqueId++;

    /**
     * The date that is currently focused or showing in the calendar. This will initially be set
     * to the ng-model value if set, otherwise to today. It will be updated as the user navigates
     * to other months. The cell corresponding to the displayDate does not necesarily always have
     * focus in the document (such as for cases when the user is scrolling the calendar).
     * @type {Date}
     */
    this.displayDate = null;

    /**
     * Allows restricting the calendar to only allow selecting a month or a day.
     * @type {'month'|'day'|null}
     */
    this.mode = null;

    /**
     * The selected date. Keep track of this separately from the ng-model value so that we
     * can know, when the ng-model value changes, what the previous value was before it's updated
     * in the component's UI.
     *
     * @type {Date}
     */
    this.selectedDate = null;

    /**
     * The first date that can be rendered by the calendar. The default is taken
     * from the mdDateLocale provider and is limited by the mdMinDate.
     * @type {Date}
     */
    this.firstRenderableDate = null;

    /**
     * The last date that can be rendered by the calendar. The default comes
     * from the mdDateLocale provider and is limited by the maxDate.
     * @type {Date}
     */
    this.lastRenderableDate = null;

    /**
     * Cache for the  width of the element without a scrollbar. Used to hide the scrollbar later on
     * and to avoid extra reflows when switching between views.
     * @type {Number}
     */
    this.width = 0;

    /**
     * Caches the width of the scrollbar in order to be used when hiding it and to avoid extra reflows.
     * @type {Number}
     */
    this.scrollbarWidth = 0;

    // Unless the user specifies so, the calendar should not be a tab stop.
    // This is necessary because ngAria might add a tabindex to anything with an ng-model
    // (based on whether or not the user has turned that particular feature on/off).
    if (!$attrs.tabindex) {
      $element.attr('tabindex', '-1');
    }

    var boundKeyHandler = angular.bind(this, this.handleKeyEvent);

    // If use the md-calendar directly in the body without datepicker,
    // handleKeyEvent will disable other inputs on the page.
    // So only apply the handleKeyEvent on the body when the md-calendar inside datepicker,
    // otherwise apply on the calendar element only.

    var handleKeyElement;
    if ($element.parent().hasClass('md-datepicker-calendar')) {
      handleKeyElement = angular.element(document.body);
    } else {
      handleKeyElement = $element;
    }

    // Bind the keydown handler to the body, in order to handle cases where the focused
    // element gets removed from the DOM and stops propagating click events.
    handleKeyElement.on('keydown', boundKeyHandler);

    $scope.$on('$destroy', function() {
      handleKeyElement.off('keydown', boundKeyHandler);
    });

    // For AngularJS 1.4 and older, where there are no lifecycle hooks but bindings are pre-assigned,
    // manually call the $onInit hook.
    if (angular.version.major === 1 && angular.version.minor <= 4) {
      this.$onInit();
    }
  }

  /**
   * AngularJS Lifecycle hook for newer AngularJS versions.
   * Bindings are not guaranteed to have been assigned in the controller, but they are in the
   * $onInit hook.
   */
  CalendarCtrl.prototype.$onInit = function() {
    /**
     * The currently visible calendar view. Note the prefix on the scope value,
     * which is necessary, because the datepicker seems to reset the real one value if the
     * calendar is open, but the `currentView` on the datepicker's scope is empty.
     * @type {String}
     */
    if (this._mode && MODE_MAP.hasOwnProperty(this._mode)) {
      this.currentView = MODE_MAP[this._mode];
      this.mode = this._mode;
    } else {
      this.currentView = this._currentView || 'month';
      this.mode = null;
    }

    if (this.minDate && this.minDate > this.$mdDateLocale.firstRenderableDate) {
      this.firstRenderableDate = this.minDate;
    } else {
      this.firstRenderableDate = this.$mdDateLocale.firstRenderableDate;
    }

    if (this.maxDate && this.maxDate < this.$mdDateLocale.lastRenderableDate) {
      this.lastRenderableDate = this.maxDate;
    } else {
      this.lastRenderableDate = this.$mdDateLocale.lastRenderableDate;
    }
  };

  /**
   * Sets up the controller's reference to ngModelController.
   * @param {!ngModel.NgModelController} ngModelCtrl Instance of the ngModel controller.
   * @param {Object} inputDirective Config for Angular's `input` directive.
   */
  CalendarCtrl.prototype.configureNgModel = function(ngModelCtrl, inputDirective) {
    var self = this;
    self.ngModelCtrl = ngModelCtrl;

    // The component needs to be [type="date"] in order to be picked up by AngularJS.
    this.$attrs.$set('type', 'date');

    // Invoke the `input` directive link function, adding a stub for the element.
    // This allows us to re-use AngularJS' logic for setting the timezone via ng-model-options.
    // It works by calling the link function directly which then adds the proper `$parsers` and
    // `$formatters` to the NgModelController.
    inputDirective[0].link.pre(this.$scope, {
      on: angular.noop,
      val: angular.noop,
      0: {}
    }, this.$attrs, [ngModelCtrl]);

    ngModelCtrl.$render = function() {
      var value = this.$viewValue;
      var parsedValue, convertedValue;

      // In the case where a conversion is needed, the $viewValue here will be a string like
      // "2020-05-10" instead of a Date object.
      if (!self.dateUtil.isValidDate(value)) {
        parsedValue = self.$mdDateLocale.parseDate(this.$viewValue);
        convertedValue =
          new Date(parsedValue.getTime() + 60000 * parsedValue.getTimezoneOffset());
        if (self.dateUtil.isValidDate(convertedValue)) {
          value = convertedValue;
        }
      }

      // Notify the child scopes of any changes.
      self.$scope.$broadcast('md-calendar-parent-changed', value);

      // Set up the selectedDate if it hasn't been already.
      if (!self.selectedDate) {
        self.selectedDate = value;
      }

      // Also set up the displayDate.
      if (!self.displayDate) {
        self.displayDate = self.selectedDate || self.today;
      }
    };
  };

  /**
   * Sets the ng-model value for the calendar and emits a change event.
   * @param {Date} date new value for the calendar
   */
  CalendarCtrl.prototype.setNgModelValue = function(date) {
    var timezone = this.$mdUtil.getModelOption(this.ngModelCtrl, 'timezone');
    var value = this.dateUtil.createDateAtMidnight(date);
    this.focusDate(value);
    this.$scope.$emit('md-calendar-change', value);
    this.ngModelCtrl.$setViewValue(this.ngDateFilter(value, 'yyyy-MM-dd', timezone), 'default');
    this.ngModelCtrl.$render();
    return value;
  };

  /**
   * Sets the current view that should be visible in the calendar
   * @param {string} newView View name to be set.
   * @param {number|Date} time Date object or a timestamp for the new display date.
   */
  CalendarCtrl.prototype.setCurrentView = function(newView, time) {
    var self = this;

    self.$mdUtil.nextTick(function() {
      self.currentView = newView;

      if (time) {
        self.displayDate = angular.isDate(time) ? time : new Date(time);
      }
    });
  };

  /**
   * Focus the cell corresponding to the given date.
   * @param {Date=} date The date to be focused.
   */
  CalendarCtrl.prototype.focusDate = function(date) {
    if (this.dateUtil.isValidDate(date)) {
      var previousFocus = this.$element[0].querySelector('.' + this.FOCUSED_DATE_CLASS);
      if (previousFocus) {
        previousFocus.classList.remove(this.FOCUSED_DATE_CLASS);
      }

      var cellId = this.getDateId(date, this.currentView);
      var cell = document.getElementById(cellId);
      if (cell) {
        cell.classList.add(this.FOCUSED_DATE_CLASS);
        cell.focus();
        this.displayDate = date;
      }
    } else {
      var rootElement = this.$element[0].querySelector('[ng-switch]');

      if (rootElement) {
        rootElement.focus();
      }
    }
  };

  /**
   * Highlights a date cell on the calendar and changes the selected date.
   * @param {Date=} date Date to be marked as selected.
   */
  CalendarCtrl.prototype.changeSelectedDate = function(date) {
    var selectedDateClass = this.SELECTED_DATE_CLASS;
    var prevDateCell = this.$element[0].querySelector('.' + selectedDateClass);

    // Remove the selected class from the previously selected date, if any.
    if (prevDateCell) {
      prevDateCell.classList.remove(selectedDateClass);
      prevDateCell.setAttribute('aria-selected', 'false');
    }

    // Apply the select class to the new selected date if it is set.
    if (date) {
      var dateCell = document.getElementById(this.getDateId(date, this.currentView));
      if (dateCell) {
        dateCell.classList.add(selectedDateClass);
        dateCell.setAttribute('aria-selected', 'true');
      }
    }

    this.selectedDate = date;
  };

  /**
   * Normalizes the key event into an action name. The action will be broadcast
   * to the child controllers.
   * @param {KeyboardEvent} event
   * @returns {String} The action that should be taken, or null if the key
   * does not match a calendar shortcut.
   */
  CalendarCtrl.prototype.getActionFromKeyEvent = function(event) {
    var keyCode = this.keyCode;

    switch (event.which) {
      case keyCode.ENTER: return 'select';

      case keyCode.RIGHT_ARROW: return 'move-right';
      case keyCode.LEFT_ARROW: return 'move-left';

      case keyCode.DOWN_ARROW: return event.metaKey ? 'move-page-down' : 'move-row-down';
      case keyCode.UP_ARROW: return event.metaKey ? 'move-page-up' : 'move-row-up';

      case keyCode.PAGE_DOWN: return 'move-page-down';
      case keyCode.PAGE_UP: return 'move-page-up';

      case keyCode.HOME: return 'start';
      case keyCode.END: return 'end';

      default: return null;
    }
  };

  /**
   * Handles a key event in the calendar with the appropriate action. The action will either
   * be to select the focused date or to navigate to focus a new date.
   * @param {KeyboardEvent} event
   */
  CalendarCtrl.prototype.handleKeyEvent = function(event) {
    var self = this;

    this.$scope.$apply(function() {
      // Capture escape and emit back up so that a wrapping component
      // (such as a date-picker) can decide to close.
      if (event.which === self.keyCode.ESCAPE || event.which === self.keyCode.TAB) {
        self.$scope.$emit('md-calendar-close');

        if (event.which === self.keyCode.TAB) {
          event.preventDefault();
        }

        return;
      }

      // Broadcast the action that any child controllers should take.
      var action = self.getActionFromKeyEvent(event);
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        self.$scope.$broadcast('md-calendar-parent-action', action);
      }
    });
  };

  /**
   * Hides the vertical scrollbar on the calendar scroller of a child controller by
   * setting the width on the calendar scroller and the `overflow: hidden` wrapper
   * around the scroller, and then setting a padding-right on the scroller equal
   * to the width of the browser's scrollbar.
   *
   * This will cause a reflow.
   *
   * @param {object} childCtrl The child controller whose scrollbar should be hidden.
   */
  CalendarCtrl.prototype.hideVerticalScrollbar = function(childCtrl) {
    var self = this;
    var element = childCtrl.$element[0];
    var scrollMask = element.querySelector('.md-calendar-scroll-mask');

    if (self.width > 0) {
      setWidth();
    } else {
      self.$$rAF(function() {
        var scroller = childCtrl.calendarScroller;

        self.scrollbarWidth = scroller.offsetWidth - scroller.clientWidth;
        self.width = element.querySelector('table').offsetWidth;
        setWidth();
      });
    }

    function setWidth() {
      var width = self.width || FALLBACK_WIDTH;
      var scrollbarWidth = self.scrollbarWidth;
      var scroller = childCtrl.calendarScroller;

      scrollMask.style.width = width + 'px';
      scroller.style.width = (width + scrollbarWidth) + 'px';
      scroller.style.paddingRight = scrollbarWidth + 'px';
    }
  };

  /**
   * Gets an identifier for a date unique to the calendar instance for internal
   * purposes. Not to be displayed.
   * @param {Date} date The date for which the id is being generated
   * @param {string} namespace Namespace for the id. (month, year etc.)
   * @returns {string}
   */
  CalendarCtrl.prototype.getDateId = function(date, namespace) {
    if (!namespace) {
      throw new Error('A namespace for the date id has to be specified.');
    }

    return [
      'md',
      this.id,
      namespace,
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    ].join('-');
  };

  /**
   * Util to trigger an extra digest on a parent scope, in order to to ensure that
   * any child virtual repeaters have updated. This is necessary, because the virtual
   * repeater doesn't update the $index the first time around since the content isn't
   * in place yet. The case, in which this is an issue, is when the repeater has less
   * than a page of content (e.g. a month or year view has a min or max date).
   */
  CalendarCtrl.prototype.updateVirtualRepeat = function() {
    var scope = this.$scope;
    var virtualRepeatResizeListener = scope.$on('$md-resize-enable', function() {
      if (!scope.$$phase) {
        scope.$apply();
      }

      virtualRepeatResizeListener();
    });
  };
})();
