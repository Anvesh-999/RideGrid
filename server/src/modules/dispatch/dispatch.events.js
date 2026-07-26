import { EventEmitter } from 'events';

const dispatchEvents = new EventEmitter();

// Increase limit to avoid memory leak warning if many dispatch loops run concurrently
dispatchEvents.setMaxListeners(100);

export default dispatchEvents;
