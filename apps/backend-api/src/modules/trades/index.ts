// The trades module's public surface (design §4.2). Other modules may use the state machine, the
// eligibility gates, the events and the tables through this barrel, and nothing else: the
// komtru/module-boundaries rule makes this the only way in. T-061 adds the services and routes.
export * from './domain/stateMachine.js';
export * from './domain/errors.js';
export * from './domain/eligibility.js';
export * from './domain/events.js';
export * from './domain/tradeCode.js';
export * from './domain/feeSnapshot.js';
export * from './infrastructure/postgres/schema/index.js';
export * from './infrastructure/postgres/transitions.js';
export * from './infrastructure/postgres/tradeCodes.js';
export * from './infrastructure/postgres/principals.js';
export * from './domain/proposal.js';
export * from './domain/fulfilment.js';
export * from './domain/deliverySignal.js';
export * from './domain/deadline.js';
export * from './domain/fulfilmentEvents.js';
export * from './domain/cancellationEvents.js';
export * from './domain/inspection.js';
export * from './domain/inspectionEvents.js';
export * from './infrastructure/notifications.js';
export * from './services/trade.service.js';
export * from './services/tradeActivity.service.js';
export * from './domain/tradeActivity.js';
export * from './services/proposal.service.js';
export * from './services/fulfilment.service.js';
export * from './services/fulfilmentPorts.js';
export * from './services/deliverySignal.service.js';
export * from './services/deadline.service.js';
export * from './services/inspection.service.js';
export * from './services/inspectionDeadline.service.js';
export * from './services/funding.service.js';
export * from './services/cancellation.service.js';
export * from './services/inspectionReminder.service.js';
export * from './services/inspectionPorts.js';
export { createTradesModule, type TradesModuleOptions } from './module.js';
