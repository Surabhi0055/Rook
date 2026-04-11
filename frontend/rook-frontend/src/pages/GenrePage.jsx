import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, dedup, cleanImageUrl } from '../hooks/useBooks'

// SEED CLUSTERS — For every genre's top books, we define tightly-related "similar book" queries. These run first and their results are ranked highest, pushing the most relevant books to the top.

const SEED_CLUSTERS = {
  // ── FICTION ──────────────────────────────────────────────
  fiction: [
    { seed: 'The Kite Runner', similar: ['A Thousand Splendid Suns Khaled Hosseini', 'The Swallows of Kabul', 'And the Mountains Echoed', 'The Pearl That Broke Its Shell', 'A Long Way Gone'] },
    { seed: 'A Little Life', similar: ['The Goldfinch Donna Tartt', 'Less Andrew Sean Greer', 'Beautiful Boy David Sheff', 'Hanya Yanagihara', 'The Secret History', 'Commonwealth Ann Patchett'] },
    { seed: 'Normal People', similar: ['Conversations with Friends Sally Rooney', 'Beautiful World Where Are You', 'Exciting Times Naoise Dolan', 'Actresses Anne Enright', 'Intermezzo Sally Rooney'] },
    { seed: 'Where the Crawdads Sing', similar: ['The Great Alone Kristin Hannah', 'Before We Were Yours Lisa Wingate', 'Firefly Lane Kristin Hannah', 'The Four Winds Kristin Hannah', 'Beneath a Scarlet Sky Mark Sullivan'] },
  ],

  // ── FANTASY ──────────────────────────────────────────────
  fantasy: [
    { seed: 'The Lord of the Rings', similar: ['The Silmarillion Tolkien', 'The Children of Hurin', 'The Dragonbone Chair Tad Williams', 'Malazan Book of the Fallen', 'The Sword of Kaigen', 'The Deed of Paksenarrion'] },
    { seed: 'The Name of the Wind', similar: ['The Wise Mans Fear Patrick Rothfuss', 'The Slow Regard of Silent Things', 'The Stormlight Archive Brandon Sanderson', 'The Final Empire Mistborn', 'Warbreaker Brandon Sanderson'] },
    { seed: 'The Way of Kings', similar: ['Words of Radiance Sanderson', 'Rhythm of War', 'Oathbringer Sanderson', 'Elantris Brandon Sanderson', 'Arcanum Unbounded'] },
    { seed: 'A Wizard of Earthsea', similar: ['The Tombs of Atuan Le Guin', 'Tehanu Le Guin', 'The Farthest Shore', 'The Chronicles of Narnia CS Lewis', 'His Dark Materials Philip Pullman'] },
    { seed: 'Mistborn', similar: ['The Well of Ascension', 'The Hero of Ages', 'Alloy of Law Mistborn', 'Shadows of Self', 'Bands of Mourning'] },
    { seed: 'The Hobbit', similar: ['The Fellowship of the Ring', 'The Two Towers Tolkien', 'The Return of the King', 'Eragon Christopher Paolini', 'Inkheart Cornelia Funke'] },
  ],

  // ── MYSTERY ──────────────────────────────────────────────
  mystery: [
    { seed: 'And Then There Were None', similar: ['Murder on the Orient Express Agatha Christie', 'Death on the Nile Christie', 'The ABC Murders', 'Crooked House Christie', 'Five Little Pigs Christie', 'A Caribbean Mystery'] },
    { seed: 'The Girl with the Dragon Tattoo', similar: ['The Girl Who Played with Fire', 'The Girl Who Kicked the Hornets Nest', 'The Girl in the Spiders Web', 'Millennium series Larsson', 'The Hypnotist Lars Kepler'] },
    { seed: 'Big Little Lies', similar: ['Nine Perfect Strangers Liane Moriarty', 'The Husband Secret', 'Truly Madly Guilty Liane Moriarty', 'What Alice Forgot', 'Apples Never Fall Liane Moriarty'] },
    { seed: 'Gone Girl', similar: ['The Woman in the Window AJ Finn', 'Behind Closed Doors BA Paris', 'The Silent Patient Alex Michaelides', 'Sharp Objects Gillian Flynn', 'Dark Places Gillian Flynn'] },
  ],

  // ── ROMANCE ──────────────────────────────────────────────
  romance: [
    { seed: 'The Notebook', similar: ['A Walk to Remember Nicholas Sparks', 'Message in a Bottle', 'Nights in Rodanthe', 'Dear John Nicholas Sparks', 'The Lucky One Nicholas Sparks'] },
    { seed: 'Me Before You', similar: ['After You Jojo Moyes', 'Still Me Jojo Moyes', 'One Plus One Jojo Moyes', 'The Giver of Stars Jojo Moyes', 'Paris for One Jojo Moyes'] },
    { seed: 'Outlander', similar: ['Dragonfly in Amber Diana Gabaldon', 'Voyager Gabaldon', 'Drums of Autumn', 'The Fiery Cross Gabaldon', 'A Breath of Snow and Ashes'] },
    { seed: 'Pride and Prejudice', similar: ['Sense and Sensibility Austen', 'Emma Jane Austen', 'Persuasion Austen', 'Mansfield Park', 'Northanger Abbey Austen'] },
  ],

  // ── THRILLER ──────────────────────────────────────────────
  thriller: [
    { seed: 'Gone Girl', similar: ['The Woman in the Window', 'Behind Closed Doors BA Paris', 'The Silent Patient', 'The Wife Between Us', 'An Anonymous Girl Greer Hendricks'] },
    { seed: 'The Girl on the Train', similar: ['Into the Water Paula Hawkins', 'The Dry Jane Harper', 'Force of Nature Jane Harper', 'Local Woman Missing', 'The Turn of the Key Ruth Ware'] },
    { seed: 'The Silent Patient', similar: ['The Maidens Alex Michaelides', 'The Therapist BA Paris', 'The Housemaid Freida McFadden', 'The Locked Door Freida McFadden', 'Behind Her Eyes Sarah Pinborough'] },
    { seed: 'Big Little Lies', similar: ['The Couple Next Door Shari Lapena', 'An Unwanted Guest Ruth Ware', 'In a Dark Dark Wood Ruth Ware', 'The Woman in Cabin 10 Ruth Ware', 'One by One Ruth Ware'] },
  ],

  // ── SCIENCE FICTION ──────────────────────────────────────
  'science fiction': [
    { seed: 'Dune', similar: ['Dune Messiah Frank Herbert', 'Children of Dune', 'God Emperor of Dune', 'Revelation Space Alastair Reynolds', 'The Left Hand of Darkness Le Guin'] },
    { seed: 'The Martian', similar: ['Project Hail Mary Andy Weir', 'Artemis Andy Weir', 'The Long Way to a Small Angry Planet', 'A Memory Called Empire', 'Children of Time Adrian Tchaikovsky'] },
    { seed: 'Enders Game', similar: ['Enders Shadow Orson Scott Card', 'Speaker for the Dead', 'Xenocide Card', 'Children of the Mind', 'Pathfinder Orson Scott Card'] },
    { seed: 'The Hitchhikers Guide to the Galaxy', similar: ['The Restaurant at the End of the Universe', 'Life the Universe and Everything', 'So Long and Thanks for All the Fish', 'Mostly Harmless Douglas Adams', 'Dirk Gently Adams'] },
  ],

  // ── HORROR ──────────────────────────────────────────────
  horror: [
    { seed: 'It', similar: ['The Stand Stephen King', 'Pet Sematary King', 'Needful Things', 'Insomnia King', 'Dreamcatcher King', 'Bag of Bones King'] },
    { seed: 'The Shining', similar: ['Doctor Sleep Stephen King', 'The Overlook Hotel', 'Firestarter King', 'Cujo King', 'Carrie King', 'Misery King'] },
    { seed: 'Bird Box', similar: ['The Troop Nick Cutter', 'The Ritual Adam Nevill', 'Caraval Stephanie Garber', 'A Head Full of Ghosts Paul Tremblay', 'Disappearance at Devils Rock Paul Tremblay'] },
    { seed: 'Mexican Gothic', similar: ['The October Country Ray Bradbury', 'Something Wicked This Way Comes', 'In the Tall Grass King', 'White Is for Witching Helen Oyeyemi', 'The Hacienda Isabel Canas'] },
    { seed: 'House of Leaves', similar: ['The Loop Jeremy Robert Johnson', 'The Fisherman John Langan', 'NOS4A2 Joe Hill', 'Heart-Shaped Box Joe Hill', 'Horns Joe Hill'] },
  ],

  // ── BIOGRAPHY ──────────────────────────────────────────────
  biography: [
    { seed: 'Educated', similar: ['The Glass Castle Jeannette Walls', 'Hillbilly Elegy JD Vance', 'Hunger Roxane Gay', 'Know My Name Chanel Miller', 'The Woman in Me Britney Spears'] },
    { seed: 'The Glass Castle', similar: ['A Tree Grows in Brooklyn Betty Smith', 'This Boy Trevor Noah', 'Small Fry Lisa Brennan Jobs', 'Beautiful Boy David Sheff', 'Tweak Nic Sheff'] },
    { seed: 'Becoming', similar: ['My Own Words Ruth Bader Ginsburg', 'The Autobiography of Malcolm X', 'Long Walk to Freedom Mandela', 'Just Kids Patti Smith', 'Open Andre Agassi'] },
    { seed: 'Born a Crime', similar: ['Between the World and Me Ta-Nehisi Coates', 'The Hate U Give Angie Thomas', 'You Cant Touch My Hair Phoebe Robinson', 'I Am Not Your Negro James Baldwin'] },
  ],

  // ── HISTORY ──────────────────────────────────────────────
  history: [
    { seed: 'Sapiens', similar: ['Homo Deus Yuval Noah Harari', '21 Lessons for the 21st Century Harari', 'Guns Germs and Steel Jared Diamond', 'The Fate of Rome Kyle Harper', 'Collapse Jared Diamond'] },
    { seed: 'The Guns of August', similar: ['The First World War John Keegan', 'Catastrophe 1914 Max Hastings', 'A World Undone GJ Meyer', 'The Sleepwalkers Christopher Clark', 'To End All Wars Adam Hochschild'] },
    { seed: 'SPQR', similar: ['Rubicon Tom Holland', 'Dynasty Tom Holland', 'The Storm Before the Storm Mike Duncan', 'The Fall of the Roman Empire Peter Heather', 'How Rome Fell Adrian Goldsworthy'] },
    { seed: 'The Diary of a Young Girl', similar: ['Night Elie Wiesel', 'Mans Search for Meaning Frankl', 'If This Is a Man Primo Levi', 'The Pianist Wladyslaw Szpilman', 'Maus Art Spiegelman'] },
  ],

  // ── SELF-HELP ──────────────────────────────────────────────
  'self-help': [
    { seed: 'Atomic Habits', similar: ['Tiny Habits BJ Fogg', 'The Power of Habit Charles Duhigg', 'Good Habits Bad Habits Wendy Wood', 'Make Your Bed William McRaven', 'Deep Work Cal Newport'] },
    { seed: 'The Power of Now', similar: ['A New Earth Eckhart Tolle', 'Stillness Speaks Tolle', 'The Untethered Soul Michael Singer', 'The Surrender Experiment Michael Singer', 'Practicing the Power of Now'] },
    { seed: 'Think and Grow Rich', similar: ['The Richest Man in Babylon George Clason', 'Outwitting the Devil Napoleon Hill', 'The Science of Getting Rich Wallace Wattles', 'The Magic of Thinking Big David Schwartz'] },
    { seed: 'The 7 Habits of Highly Effective People', similar: ['The 8th Habit Stephen Covey', 'First Things First Covey', 'Principle-Centered Leadership', 'The Speed of Trust Stephen Covey', 'The Leader in Me'] },
  ],

  // ── COMEDY ──────────────────────────────────────────────
  comedy: [
    { seed: 'Good Omens', similar: ['Pratchett Discworld', 'The Colour of Magic', 'Wyrd Sisters Pratchett', 'Mort Pratchett', 'Guards Guards Pratchett', 'Soul Music Pratchett'] },
    { seed: 'Three Men in a Boat', similar: ['Three Men on the Bummel Jerome', 'My Man Jeeves PG Wodehouse', 'The Inimitable Jeeves', 'Right Ho Jeeves', 'Joy in the Morning Wodehouse'] },
    { seed: 'A Man Called Ove', similar: ['The 100-Year-Old Man Who Climbed Out the Window Jonas Jonasson', 'The Hundred and One Dalmatians', 'Anxious People Fredrik Backman', 'Beartown Fredrik Backman', 'My Grandmother Asked Me to Tell You She is Sorry'] },
  ],

  // ── YOUNG ADULT ──────────────────────────────────────────
  'young-adult': [
    { seed: 'The Fault in Our Stars', similar: ['Looking for Alaska John Green', 'An Abundance of Katherines', 'Paper Towns John Green', 'Turtles All the Way Down John Green', 'Will Grayson Will Grayson'] },
    { seed: 'Harry Potter', similar: ['Harry Potter Sorcerers Stone', 'Harry Potter Chamber of Secrets', 'Harry Potter Prisoner of Azkaban', 'Harry Potter Goblet of Fire', 'Harry Potter Order of the Phoenix', 'Harry Potter Half Blood Prince', 'Harry Potter Deathly Hallows'] },
    { seed: 'The Hunger Games', similar: ['Catching Fire Suzanne Collins', 'Mockingjay Suzanne Collins', 'Divergent Veronica Roth', 'Insurgent Roth', 'Allegiant Roth', 'The Maze Runner James Dashner'] },
    { seed: 'To All the Boys Ive Loved Before', similar: ['P.S. I Still Love You Jenny Han', 'Always and Forever Lara Jean', 'The Summer I Turned Pretty Jenny Han'] },
  ],

  // ── CLASSICS ──────────────────────────────────────────────
  classics: [
    { seed: 'Pride and Prejudice', similar: ['Sense and Sensibility', 'Emma Austen', 'Persuasion Austen', 'Mansfield Park', 'Northanger Abbey'] },
    { seed: 'Jane Eyre', similar: ['Wuthering Heights Emily Bronte', 'Villette Charlotte Bronte', 'Agnes Grey Anne Bronte', 'The Tenant of Wildfell Hall', 'Rebecca Daphne du Maurier'] },
    { seed: 'Anna Karenina', similar: ['War and Peace Tolstoy', 'The Death of Ivan Ilyich', 'Resurrection Tolstoy', 'Crime and Punishment Dostoevsky', 'The Brothers Karamazov', 'The Idiot Dostoevsky'] },
    { seed: 'Great Expectations', similar: ['Oliver Twist Dickens', 'A Tale of Two Cities', 'David Copperfield Dickens', 'Bleak House Dickens', 'The Pickwick Papers'] },
  ],

  // ── CRIME ──────────────────────────────────────────────
  crime: [
    { seed: 'In Cold Blood', similar: ['Helter Skelter Vincent Bugliosi', 'Ill Be Gone in the Dark Michelle McNamara', 'Under the Banner of Heaven Jon Krakauer', 'Columbine Dave Cullen', 'The Monster of Florence'] },
    { seed: 'The Big Sleep', similar: ['Farewell My Lovely Raymond Chandler', 'The Long Goodbye Chandler', 'The Little Sister', 'Playback Chandler', 'The High Window Chandler'] },
    { seed: 'No Country for Old Men', similar: ['Blood Meridian Cormac McCarthy', 'The Road Cormac McCarthy', 'Suttree McCarthy', 'Child of God McCarthy', 'Outer Dark McCarthy'] },
    { seed: 'Tana French Dublin Murder', similar: ['In the Woods Tana French', 'The Likeness Tana French', 'Faithful Place', 'Broken Harbour', 'The Secret Place Tana French'] },
  ],

  // ── PARANORMAL ──────────────────────────────────────────
  paranormal: [
    { seed: 'Twilight', similar: ['New Moon Stephenie Meyer', 'Eclipse Stephenie Meyer', 'Breaking Dawn Stephenie Meyer', 'Midnight Sun Meyer', 'The Host Stephenie Meyer'] },
    { seed: 'American Gods', similar: ['Anansi Boys Neil Gaiman', 'Norse Mythology Gaiman', 'Good Omens Gaiman Pratchett', 'Ocean at the End of the Lane Gaiman', 'Neverwhere Gaiman'] },
    { seed: 'Practical Magic', similar: ['The Rules of Magic Alice Hoffman', 'Magic Lessons Alice Hoffman', 'The Book of Magic Alice Hoffman', 'Illuminae Files', 'The Witch of Blackbird Pond'] },
  ],

  // ── ADVENTURE ──────────────────────────────────────────
  adventure: [
    { seed: 'The Alchemist', similar: ['Siddhartha Hermann Hesse', 'Jonathan Livingston Seagull', 'The Little Prince Antoine de Saint-Exupery', 'Illusions Richard Bach', 'The Prophet Kahlil Gibran'] },
    { seed: 'Life of Pi', similar: ['The Old Man and the Sea Hemingway', 'Endurance Alfred Lansing', 'Touching the Void Joe Simpson', 'Into Thin Air Jon Krakauer', 'The Worst Case Scenario'] },
    { seed: 'Into the Wild', similar: ['Wild Cheryl Strayed', 'A Walk in the Woods Bill Bryson', 'In a Sunburned Country Bryson', 'The Lost City of Z David Grann', 'Killers of the Flower Moon'] },
  ],

  // ── NON-FICTION ──────────────────────────────────────────
  'non-fiction': [
    { seed: 'Sapiens', similar: ['Homo Deus Harari', 'The Better Angels of Our Nature Pinker', 'Enlightenment Now Pinker', 'The Silk Roads Peter Frankopan', 'Prisoners of Geography Tim Marshall'] },
    { seed: 'The Body', similar: ['A Short History of Nearly Everything Bryson', 'The Body: A Guide for Occupants', 'Being Mortal Atul Gawande', 'Emperor of All Maladies Siddhartha Mukherjee', 'The Gene Mukherjee'] },
    { seed: 'Freakonomics', similar: ['SuperFreakonomics', 'Thinking Fast and Slow Kahneman', 'Predictably Irrational Dan Ariely', 'Nudge Thaler Sunstein', 'Misbehaving Richard Thaler'] },
  ],

  // ── PSYCHOLOGY ──────────────────────────────────────────
  psychology: [
    { seed: 'Thinking Fast and Slow', similar: ['Noise Daniel Kahneman', 'Behave Robert Sapolsky', 'The Undoing Project Michael Lewis', 'Predictably Irrational', 'Thinking in Bets Annie Duke'] },
    { seed: 'The Body Keeps the Score', similar: ['Trauma and Recovery Judith Herman', 'In an Unspoken Voice Peter Levine', 'Waking the Tiger Peter Levine', 'What Happened to You Bruce Perry', 'Complex PTSD Pete Walker'] },
    { seed: 'Mans Search for Meaning', similar: ['The Will to Meaning Frankl', 'The Doctor and the Soul Frankl', 'Yes to Life Frankl', 'Being and Nothingness Sartre', 'The Myth of Sisyphus Camus'] },
    { seed: 'Flow', similar: ['Creativity Csikszentmihalyi', 'The Evolving Self', 'Finding Flow', 'Optimal Csikszentmihalyi', 'Drive Daniel Pink'] },
  ],

  // ── PHILOSOPHY ──────────────────────────────────────────
  philosophy: [
    { seed: 'Meditations', similar: ['Letters from a Stoic Seneca', 'Discourses Epictetus', 'The Daily Stoic Ryan Holiday', 'Stillness Is the Key Ryan Holiday', 'Ego Is the Enemy Ryan Holiday'] },
    { seed: 'Sophies World', similar: ['The Story of Philosophy Will Durant', 'History of Western Philosophy Bertrand Russell', 'Philosophy 101 by Socrates', 'Plato at the Googleplex Rebecca Goldstein'] },
    { seed: 'The Republic', similar: ['Symposium Plato', 'The Apology Plato', 'Nicomachean Ethics Aristotle', 'Politics Aristotle', 'Metaphysics Aristotle'] },
  ],

  // ── POETRY ──────────────────────────────────────────────
  poetry: [
    { seed: 'The Sun and Her Flowers', similar: ['Rupi Kaur milk and honey', 'Home Body Rupi Kaur', 'Healing Through Words Rupi Kaur', 'Instapoetry collection', 'I Wrote This for You Pleasefindthis'] },
    { seed: 'Milk and Honey', similar: ['The Princess Saves Herself in This One Amanda Lovelace', 'You Are the Everything Karen Rivers', 'Long Way Down Jason Reynolds', 'Everything I Know About Love Dolly Alderton poetry'] },
    { seed: 'Leaves of Grass', similar: ['Song of Myself Whitman', 'Drum Taps Whitman', 'The Complete Poems of Emily Dickinson', 'Ariel Sylvia Plath', 'The Bell Jar Plath prose'] },
  ],

  // ── GRAPHIC NOVEL ──────────────────────────────────────
  'graphic novel': [
    { seed: 'Maus', similar: ['The Complete Persepolis', 'Fun Home Alison Bechdel', 'Blankets Craig Thompson', 'March John Lewis', 'When the Wind Blows Raymond Briggs'] },
    { seed: 'Watchmen', similar: ['V for Vendetta Alan Moore', 'The League of Extraordinary Gentlemen', 'From Hell Alan Moore', 'Batman the Dark Knight Returns', 'Batman Year One Frank Miller'] },
    { seed: 'Saga', similar: ['Y The Last Man Brian K Vaughan', 'Paper Girls Brian K Vaughan', 'Pride of Baghdad', 'The Walking Dead Robert Kirkman', 'East of West Jonathan Hickman'] },
    { seed: 'Persepolis', similar: ['Skim Jillian Tamaki', 'Nimona Noelle Stevenson', 'Smile Raina Telgemeier', 'Drama Raina Telgemeier', 'El Deafo Cece Bell'] },
  ],

  // ── CHILDREN ──────────────────────────────────────────
  children: [
    { seed: 'Matilda', similar: ['James and the Giant Peach Roald Dahl', 'The BFG Dahl', 'Charlie and the Chocolate Factory', 'Danny the Champion of the World', 'Fantastic Mr Fox'] },
    { seed: 'Charlottes Web', similar: ['Stuart Little EB White', 'The Trumpet of the Swan', 'The Wind in the Willows', 'Tuck Everlasting Natalie Babbitt', 'Mrs Frisby and the Rats of NIMH'] },
    { seed: 'Percy Jackson', similar: ['The Lightning Thief Rick Riordan', 'Sea of Monsters', 'The Titans Curse', 'The Battle of the Labyrinth', 'The Last Olympian Riordan'] },
  ],

  // ── ROM-COM ──────────────────────────────────────────────
  'rom-com': [
    { seed: 'Bridget Jones', similar: ['Bridget Joness Diary Helen Fielding', 'The Edge of Reason Fielding', 'Bridget Jones Mad About the Boy', 'About a Boy Nick Hornby', 'High Fidelity Nick Hornby'] },
    { seed: 'Confessions of a Shopaholic', similar: ['Shopaholic Abroad Sophie Kinsella', 'Shopaholic Ties the Knot', 'Shopaholic and Baby', 'Mini Shopaholic Kinsella', 'I Owe You One Sophie Kinsella'] },
    { seed: 'The Devil Wears Prada', similar: ['Revenge Wears Prada Lauren Weisberger', 'The Singles Game Lauren Weisberger', 'Everyone Worth Knowing Lauren Weisberger', 'Chasing Harry Winston Weisberger', 'Where the Grass Is Green'] },
    { seed: 'The Rosie Project', similar: ['The Rosie Effect Graeme Simsion', 'The Rosie Result', 'The Best of Adam Sharp Simsion', 'Two Steps Forward Graeme Simsion'] },
    { seed: 'The Hating Game', similar: ['Beach Read Emily Henry', 'Book Lovers Emily Henry', 'People We Meet on Vacation Emily Henry', 'Happy Place Emily Henry', 'Funny Story Emily Henry'] },
    { seed: 'Something Borrowed', similar: ['Something Blue Emily Giffin', 'Heart of the Matter Emily Giffin', 'Love the One Youre With Giffin', 'Baby Proof Emily Giffin', 'Where We Belong Giffin'] },
  ],

  // ── ACTION THRILLER ──────────────────────────────────────
  'action-thriller': [
    { seed: 'The Bourne Identity', similar: ['The Bourne Supremacy Ludlum', 'The Bourne Ultimatum', 'The Bourne Legacy', 'The Sigma Protocol Robert Ludlum', 'The Prometheus Deception Ludlum'] },
    { seed: 'Casino Royale', similar: ['Live and Let Die Fleming', 'From Russia with Love', 'Goldfinger Fleming', 'Thunderball Fleming', 'On Her Majestys Secret Service'] },
    { seed: 'Jack Reacher', similar: ['Killing Floor Lee Child', 'Die Trying Lee Child', 'Tripwire Lee Child', 'Running Blind Lee Child', 'Echo Burning Lee Child'] },
    { seed: 'The Da Vinci Code', similar: ['Angels and Demons Dan Brown', 'Inferno Dan Brown', 'The Lost Symbol Dan Brown', 'Origin Dan Brown', 'Digital Fortress Dan Brown'] },
  ],

  // ── HORROR THRILLER ──────────────────────────────────────
  'horror-thriller': [
    { seed: 'The Silence of the Lambs', similar: ['Red Dragon Thomas Harris', 'Hannibal Thomas Harris', 'Hannibal Rising', 'Black Sunday Harris', 'The Chesapeake Ripper'] },
    { seed: 'Sharp Objects', similar: ['Dark Places Gillian Flynn', 'Gone Girl Flynn', 'The Grownup Flynn', 'The Woman in the Window AJ Finn', 'Still Missing Chevy Stevens'] },
    { seed: 'The Whisper Man', similar: ['The Butterfly Garden Dot Hutchison', 'The Visitor Dot Hutchison', 'No Good Deed Goldy Moldavsky', 'The Last House on Needles Lane', 'Watch Me Lisa Gardner'] },
  ],

  // ── ROMANTIC SUSPENSE ──────────────────────────────────────
  'romantic-suspense': [
    { seed: 'Nora Roberts', similar: ['Nora Roberts Chesapeake Blue', 'Three Sisters Island Trilogy', 'Nora Roberts Sign of Seven', 'Nora Roberts Bride Quartet', 'Blue Smoke Nora Roberts'] },
    { seed: 'Sandra Brown', similar: ['Sandra Brown Seeing Red', 'Sandra Brown Low Pressure', 'Sandra Brown Crush', 'Sandra Brown Tailspin', 'Sandra Brown Friction'] },
    { seed: 'Harlan Coben', similar: ['Tell No One Harlan Coben', 'Gone for Good Coben', 'No Second Chance Coben', 'Hold Tight Coben', 'Caught Harlan Coben'] },
  ],

  // ── DARK FANTASY ──────────────────────────────────────────
  'dark-fantasy': [
    { seed: 'The First Law', similar: ['Before They Are Hanged Joe Abercrombie', 'Last Argument of Kings', 'Best Served Cold Abercrombie', 'The Heroes Abercrombie', 'Red Country Abercrombie'] },
    { seed: 'The Poppy War', similar: ['The Dragon Republic RF Kuang', 'The Burning God RF Kuang', 'Babel RF Kuang', 'Yellowface RF Kuang', 'She Who Became the Sun Shelley Parker-Chan'] },
    { seed: 'American Gods', similar: ['Norse Mythology Gaiman', 'Anansi Boys Gaiman', 'Ocean at the End of the Lane', 'Stardust Neil Gaiman', 'Coraline Gaiman'] },
  ],

  // ── COZY MYSTERY ──────────────────────────────────────────
  'cozy-mystery': [
    { seed: 'Miss Marple', similar: ['The Moving Finger Christie', 'A Murder Is Announced', '4:50 from Paddington', 'Nemesis Christie', 'Sleeping Murder Christie'] },
    { seed: 'The Thursday Murder Club', similar: ['The Man Who Died Twice Richard Osman', 'The Bullet That Missed Osman', 'The Last Devil to Die Osman', 'Hamish Macbeth MC Beaton'] },
    { seed: 'Flavia de Luce', similar: ['The Sweetness at the Bottom of the Pie', 'The Weed That Strings the Hangmans Bag', 'A Red Herring Without Mustard', 'I Am Half-Sick of Shadows', 'Speaking from Among the Bones'] },
  ],

  // ── SCI-FI THRILLER ──────────────────────────────────────
  'sci-fi-thriller': [
    { seed: 'Dark Matter', similar: ['Recursion Blake Crouch', 'Upgrade Blake Crouch', 'Wayward Pines Blake Crouch', 'Pines Blake Crouch', 'The Last Town Blake Crouch'] },
    { seed: 'Project Hail Mary', similar: ['The Martian Andy Weir', 'Artemis Andy Weir', 'Children of Time Adrian Tchaikovsky', 'Children of Ruin', 'A Closed and Common Orbit'] },
    { seed: 'Jurassic Park', similar: ['The Lost World Michael Crichton', 'Congo Crichton', 'Sphere Michael Crichton', 'Prey Michael Crichton', 'Timeline Michael Crichton'] },
  ],

  // ── HISTORICAL FICTION ──────────────────────────────────
  'historical-fiction': [
    { seed: 'All the Light We Cannot See', similar: ['The Nightingale Kristin Hannah', 'The Alice Network Kate Quinn', 'The Rose Code Kate Quinn', 'The Diamond Eye Kate Quinn', 'The Huntress Kate Quinn'] },
    { seed: 'The Book Thief', similar: ['Markus Zusak The Messenger', 'Bridge of Clay Zusak', 'Salt to the Sea Ruta Sepetys', 'Between Shades of Gray Ruta Sepetys', 'Ashes in the Snow Sepetys'] },
    { seed: 'Wolf Hall', similar: ['Bring Up the Bodies Hilary Mantel', 'The Mirror and the Light Mantel', 'An Instance of the Fingerpost Iain Pears', 'The Name of the Rose Umberto Eco'] },
    { seed: 'Pachinko', similar: ['The Covenant Michener', 'Hawaii Michener', 'Roots Alex Haley', 'The Joy Luck Club Amy Tan', 'The Kitchen Gods Wife Amy Tan'] },
  ],

  // ── PARANORMAL ROMANCE ──────────────────────────────────
  'paranormal-romance': [
    { seed: 'A Court of Thorns and Roses', similar: ['A Court of Mist and Fury Sarah J Maas', 'A Court of Wings and Ruin', 'A Court of Frost and Starlight', 'A Court of Silver Flames', 'Crescent City Sarah J Maas'] },
    { seed: 'Vampire Academy', similar: ['Frostbite Richelle Mead', 'Shadow Kiss Mead', 'Blood Promise Mead', 'Spirit Bound Mead', 'Last Sacrifice Richelle Mead'] },
    { seed: 'Hush Hush', similar: ['Crescendo Becca Fitzpatrick', 'Silence Fitzpatrick', 'Finale Fitzpatrick', 'Fallen Lauren Kate', 'Torment Lauren Kate'] },
  ],

  // ── LITERARY FICTION ──────────────────────────────────────
  'literary-fiction': [
    { seed: 'A Little Life', similar: ['The People in the Trees Hanya Yanagihara', 'To Paradise Yanagihara', 'Grief Is the Thing with Feathers Max Porter', 'Lanny Max Porter', 'The Virgin Suicides Jeffrey Eugenides'] },
    { seed: 'The God of Small Things', similar: ['Arundhati Roy The Ministry of Utmost Happiness', 'The White Tiger Aravind Adiga', 'A Fine Balance Rohinton Mistry', 'The Inheritance of Loss Kiran Desai', 'The Space Between Us Thrity Umrigar'] },
    { seed: 'Pachinko', similar: ['Lincoln in the Bardo George Saunders', 'A Visit from the Goon Squad Jennifer Egan', 'The Corrections Jonathan Franzen', 'Freedom Jonathan Franzen', 'Crossroads Jonathan Franzen'] },
  ],

  // ── URBAN FANTASY ──────────────────────────────────────
  'urban-fantasy': [
    { seed: 'The Dresden Files', similar: ['Storm Front Jim Butcher', 'Fool Moon Butcher', 'Grave Peril Butcher', 'Summer Knight Butcher', 'Death Masks Jim Butcher'] },
    { seed: 'Neverwhere', similar: ['American Gods Gaiman', 'Anansi Boys Gaiman', 'Stardust Gaiman', 'The Graveyard Book Gaiman', 'Coraline Gaiman'] },
    { seed: 'Ilona Andrews', similar: ['Magic Bites Ilona Andrews', 'Magic Burns', 'Magic Strikes', 'Magic Bleeds', 'Magic Slays Ilona Andrews'] },
    { seed: 'Patricia Briggs', similar: ['Moon Called Patricia Briggs', 'Blood Bound Briggs', 'Iron Kissed Briggs', 'Bone Crossed Briggs', 'Silver Borne Briggs'] },
  ],

  // ── DYSTOPIAN ──────────────────────────────────────────
  dystopian: [
    { seed: 'The Hunger Games', similar: ['Catching Fire Suzanne Collins', 'Mockingjay Collins', 'The Ballad of Songbirds and Snakes', 'Divergent Veronica Roth', 'Insurgent Roth'] },
    { seed: '1984', similar: ['Animal Farm Orwell', 'Brave New World Aldous Huxley', 'Fahrenheit 451 Ray Bradbury', 'We Yevgeny Zamyatin', 'Lord of the Flies William Golding'] },
    { seed: 'The Handmaids Tale', similar: ['The Testaments Margaret Atwood', 'Oryx and Crake Atwood', 'The Year of the Flood', 'MaddAddam Atwood', 'Station Eleven Emily St John Mandel'] },
  ],

  // ── TRUE CRIME ──────────────────────────────────────────
  'true-crime': [
    { seed: 'Ill Be Gone in the Dark', similar: ['The Golden State Killer', 'A Death in Belmont Sebastian Junger', 'Say Nothing Patrick Radden Keefe', 'Empire of Pain Keefe'] },
    { seed: 'Mindhunter', similar: ['Inside the Mind of a Serial Killer', 'The Anatomy of Evil Michael Stone', 'Whoever Fights Monsters Robert Ressler', 'I Have Life Alison Botha', 'The Monster of Florence'] },
    { seed: 'Helter Skelter', similar: ['Manson Jeff Guinn', 'The Family Ed Sanders', 'Chaos Tom O Neill', 'Hunting the Unabomber Lis Wiehl', 'American Fire Monica Hesse'] },
  ],

  // ── CHICK LIT ──────────────────────────────────────────
  'chick-lit': [
    { seed: 'Confessions of a Shopaholic', similar: ['Shopaholic Abroad Sophie Kinsella', 'Shopaholic and Sister', 'I Owe You One Sophie Kinsella', 'Can You Keep a Secret Kinsella', 'Remember Me Sophie Kinsella'] },
    { seed: 'Bridget Joness Diary', similar: ['The Edge of Reason Fielding', 'Bridget Jones Mad About the Boy', 'Olivia Joules Helen Fielding', 'About a Boy Nick Hornby', 'How to Be Good Nick Hornby'] },
    { seed: 'The Devil Wears Prada', similar: ['Revenge Wears Prada Weisberger', 'The Singles Game Weisberger', 'The Intern Lauren Layne', 'Working Girl books', 'It Girl Cecily von Ziegesar'] },
    { seed: 'Something Borrowed', similar: ['Something Blue Emily Giffin', 'Heart of the Matter Giffin', 'Love the One Youre With', 'Baby Proof Giffin', 'Where We Belong Emily Giffin'] },
  ],

  // ── SPY THRILLER ──────────────────────────────────────────
  'spy-thriller': [
    { seed: 'Tinker Tailor Soldier Spy', similar: ['The Spy Who Came in from the Cold John le Carre', 'The Looking Glass War', 'A Small Town in Germany le Carre', 'The Russia House le Carre', 'Our Man in Havana Greene'] },
    { seed: 'Daniel Silva', similar: ['The Kill Artist Daniel Silva', 'The English Assassin Silva', 'The Confessor Silva', 'A Death in Vienna Silva', 'Prince of Fire Silva'] },
    { seed: 'The Day of the Jackal', similar: ['The Odessa File Frederick Forsyth', 'The Dogs of War Forsyth','The Fist of God Forsyth', 'Avenger Frederick Forsyth'] },
  ],
}

// GENRE DEFINITIONS
const ALL_GENRES = [
  {
    key: 'fiction', label: 'Fiction',
    mood: 'contemporary literary fiction character driven emotional family drama',
    seeds: ['The Kite Runner','A Little Life','Normal People','Where the Crawdads Sing'],
    blocklist: ['erotica','explicit','adult','erotic','steamy','bdsm','smut'],
  },
  {
    key: 'fantasy', label: 'Fantasy',
    mood: 'epic fantasy magic world building quest dragons wizards adventure',
    seeds: ['The Name of the Wind','The Way of Kings','A Wizard of Earthsea','Mistborn','The Lord of the Rings','The Hobbit'],
    blocklist: ['erotica','adult fiction','explicit'],
  },
  {
    key: 'mystery', label: 'Mystery',
    mood: 'classic mystery detective investigation whodunit crime puzzle clues amateur sleuth',
    seeds: ['And Then There Were None','The Girl with the Dragon Tattoo','Big Little Lies','Gone Girl'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'romance', label: 'Romance',
    mood: 'heartwarming romance love story emotional swoony sweet relationship clean contemporary',
    seeds: ['The Notebook','Me Before You','Outlander','Pride and Prejudice'],
    blocklist: ['erotica','explicit','bdsm','smut','erotic'],
  },
  {
    key: 'thriller', label: 'Thriller',
    mood: 'psychological thriller suspense gripping twists page turner dark secrets',
    seeds: ['Gone Girl','The Girl on the Train','The Silent Patient','Big Little Lies'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'science fiction', label: 'Science Fiction',
    mood: 'science fiction space future dystopia technology speculative society',
    seeds: ['Dune','The Martian','Enders Game','The Hitchhikers Guide to the Galaxy'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'horror', label: 'Horror',
    mood: 'horror supernatural gothic dark scary terrifying atmospheric Stephen King',
    seeds: ['It','The Shining','Bird Box','Mexican Gothic','House of Leaves'],
    blocklist: ['erotica','explicit','adult fiction'],
  },
  {
    key: 'biography', label: 'Biography',
    mood: 'biography memoir inspiring true story real person non-fiction life journey',
    seeds: ['Educated','The Glass Castle','Becoming','Born a Crime'],
    blocklist: [],
  },
  {
    key: 'history', label: 'History',
    mood: 'history non-fiction world events civilisation past war politics documentary',
    seeds: ['Sapiens','The Guns of August','SPQR','The Diary of a Young Girl'],
    blocklist: [],
  },
  {
    key: 'self-help', label: 'Self-Help',
    mood: 'self help personal growth productivity mindset habits motivation success',
    seeds: ['Atomic Habits','The Power of Now','Think and Grow Rich','The 7 Habits of Highly Effective People'],
    blocklist: [],
  },
  {
    key: 'comedy', label: 'Comedy',
    mood: 'funny comedy humor satirical witty laugh out loud absurdist',
    seeds: ['The Hitchhikers Guide to the Galaxy','Good Omens','Three Men in a Boat','A Man Called Ove'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'young-adult', label: 'Young Adult',
    mood: 'young adult coming of age teen high school identity first love adventure',
    seeds: ['The Fault in Our Stars','Harry Potter','The Hunger Games','To All the Boys Ive Loved Before'],
    blocklist: ['erotica','explicit','adult','bdsm'],
  },
  {
    key: 'classics', label: 'Classics',
    mood: 'classic literature timeless masterpiece 19th century canonical great novel',
    seeds: ['Pride and Prejudice','Jane Eyre','Anna Karenina','Great Expectations','Wuthering Heights'],
    blocklist: [],
  },
  {
    key: 'crime', label: 'Crime',
    mood: 'crime noir detective murder police investigation heist thriller procedural',
    seeds: ['In Cold Blood','The Big Sleep','No Country for Old Men','Tana French Dublin Murder'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'paranormal', label: 'Paranormal',
    mood: 'paranormal supernatural ghosts witches vampires spirits haunted eerie',
    seeds: ['Twilight','American Gods','Practical Magic','Something Wicked This Way Comes'],
    blocklist: ['erotica','explicit','adult','erotic'],
  },
  {
    key: 'adventure', label: 'Adventure',
    mood: 'adventure action survival quest journey exploration high stakes hero',
    seeds: ['The Alchemist','Life of Pi','Into the Wild','Treasure Island'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'non-fiction', label: 'Non-Fiction',
    mood: 'non-fiction true facts knowledge journalism science culture society',
    seeds: ['Sapiens','The Body','Freakonomics','Thinking Fast and Slow'],
    blocklist: [],
  },
  {
    key: 'psychology', label: 'Psychology',
    mood: 'psychology mental health human behaviour mind neuroscience cognitive science',
    seeds: ['Thinking Fast and Slow','The Body Keeps the Score','Mans Search for Meaning','Flow'],
    blocklist: [],
  },
  {
    key: 'philosophy', label: 'Philosophy',
    mood: 'philosophy ethics ideas intellectual morality existentialism stoicism wisdom',
    seeds: ['Meditations','Sophies World','The Republic','Thus Spoke Zarathustra'],
    blocklist: [],
  },
  {
    key: 'poetry', label: 'Poetry',
    mood: 'poetry lyrical verse emotional introspective imagery language beauty',
    seeds: ['The Sun and Her Flowers','Milk and Honey','Leaves of Grass','Ariel'],
    blocklist: [],
  },
  {
    key: 'graphic novel', label: 'Graphic Novel',
    mood: 'graphic novel comics illustrated visual storytelling manga sequential art',
    seeds: ['Maus','Watchmen','Saga','Persepolis'],
    blocklist: ['adult','explicit','hentai'],
  },
  {
    key: 'children', label: "Children's",
    mood: 'children middle grade whimsical family adventure magical young readers',
    seeds: ['Harry Potter','Matilda','Charlottes Web','Percy Jackson'],
    blocklist: ['adult','explicit','erotica'],
  },
  // ── HYBRID GENRES ────────────────────────────────────────
  {
    key: 'rom-com', label: 'Rom-Com',
    mood: 'romantic comedy witty funny lighthearted feel-good banter meet-cute friends to lovers chick lit',
    seeds: ['The Notebook','Confessions of a Shopaholic','The Devil Wears Prada','The Rosie Project','The Hating Game','Something Borrowed'],
    searchTerms: ['bridget jones','shopaholic','devil wears prada','rosie project','hating game','beach read emily henry','book lovers emily henry','one day david nicholls','something borrowed emily giffin'],
    blocklist: ['erotica','explicit','bdsm','smut','erotic','adult fiction','steamy','dark romance'],
  },
  {
    key: 'action-thriller', label: 'Action Thriller',
    mood: 'action thriller fast paced chase espionage spy military hero danger explosive',
    seeds: ['The Bourne Identity','Casino Royale','Jack Reacher','The Da Vinci Code'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'horror-thriller', label: 'Horror Thriller',
    mood: 'horror thriller dark psychological suspense serial killer terrifying twists sinister',
    seeds: ['The Silence of the Lambs','Sharp Objects','Dark Places','Gone Girl','The Whisper Man'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'romantic-suspense', label: 'Romantic Suspense',
    mood: 'romantic suspense love danger mystery romance thriller emotional tension',
    seeds: ['The Notebook','Nora Roberts','Linda Howard','Sandra Brown','Harlan Coben'],
    blocklist: ['erotica','explicit','bdsm','adult'],
  },
  {
    key: 'dark-fantasy', label: 'Dark Fantasy',
    mood: 'dark fantasy grimdark morally grey anti-hero gritty brutal magic consequences',
    seeds: ['The First Law','The Blade Itself','The Name of the Wind','American Gods','The Poppy War'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'cozy-mystery', label: 'Cozy Mystery',
    mood: 'cozy mystery village small town amateur sleuth cats baking light-hearted gentle murder',
    seeds: ['And Then There Were None','A is for Alibi','Miss Marple','Flavia de Luce','The Thursday Murder Club'],
    blocklist: ['erotica','explicit','adult','graphic violence'],
  },
  {
    key: 'sci-fi-thriller', label: 'Sci-Fi Thriller',
    mood: 'science fiction thriller future technology danger AI surveillance dystopian suspense',
    seeds: ['Jurassic Park','The Andromeda Strain','Recursion','Dark Matter','Project Hail Mary'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'historical-fiction', label: 'Historical Fiction',
    mood: 'historical fiction period drama past setting WWII Victorian Tudor war drama',
    seeds: ['The Pillars of the Earth','All the Light We Cannot See','The Book Thief','Wolf Hall','Pachinko'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'paranormal-romance', label: 'Paranormal Romance',
    mood: 'paranormal romance supernatural love vampire werewolf fae clean fantasy romance',
    seeds: ['Twilight','A Court of Thorns and Roses','Outlander','Vampire Academy','Hush Hush'],
    blocklist: ['erotica','explicit','bdsm','adult erotica','smut'],
  },
  {
    key: 'literary-fiction', label: 'Literary Fiction',
    mood: 'literary fiction award winning Booker Pulitzer beautiful prose character study family human condition',
    seeds: ['A Little Life','Normal People','Pachinko','The Kite Runner','The God of Small Things'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'urban-fantasy', label: 'Urban Fantasy',
    mood: 'urban fantasy magic modern city witches fae supernatural detective contemporary',
    seeds: ['The Dresden Files','Ilona Andrews','Patricia Briggs','Neverwhere','American Gods'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'dystopian', label: 'Dystopian',
    mood: 'dystopian post-apocalyptic totalitarian oppressive government society rebellion survival',
    seeds: ['The Hunger Games','1984','Brave New World','Divergent','The Handmaids Tale'],
    blocklist: ['erotica','explicit','adult'],
  },
  {
    key: 'true-crime', label: 'True Crime',
    mood: 'true crime real murder serial killer criminal investigation forensics cold case',
    seeds: ['In Cold Blood','Ill Be Gone in the Dark','Mindhunter','Helter Skelter'],
    blocklist: [],
  },
  {
    key: 'chick-lit', label: 'Chick Lit',
    mood: 'chick lit women fiction career friendship dating shopping funny relatable feel good contemporary',
    seeds: ['Confessions of a Shopaholic','Bridget Joness Diary','The Devil Wears Prada','Something Borrowed','Emily Giffin'],
    blocklist: ['erotica','explicit','bdsm','adult','dark romance'],
  },
  {
    key: 'spy-thriller', label: 'Spy Thriller',
    mood: 'spy thriller espionage intelligence CIA MI6 cold war undercover double agent',
    seeds: ['Tinker Tailor Soldier Spy','The Spy Who Came in from the Cold','The Day of the Jackal','Daniel Silva'],
    blocklist: ['erotica','explicit','adult'],
  },
]

const GLOBAL_BLOCKLIST = [
  'erotica','erotic','explicit','bdsm','smut',
  'xxx','pornograph','hentai','dark erotica','steamy erotica'
]

function isClean(book, extraBlocklist = []) {
  const haystack = [
    book.title, book.authors, book.description,
    ...(book.shelves || []), ...(book.tags || []), ...(book.genres || [])
  ].join(' ').toLowerCase()
  return ![...GLOBAL_BLOCKLIST, ...extraBlocklist].some(w => haystack.includes(w.toLowerCase()))
}

// BOOK COVER
function BookCover({ book }) {
  const url = cleanImageUrl(book?.image_url)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(114,57,63,0.2)', color: 'rgba(201,168,76,0.3)' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" width="28" height="28">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    </div>
  )
  return (
    <img src={url} alt={book?.title || ''} loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
    />
  )
}

// BOOK GRID
const PAGE_SIZE = 48
function BookGrid({ books, loading, onOpen }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const loaderRef = useRef(null)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [books])
  useEffect(() => {
    if (!loaderRef.current) return
    const obs = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) setVisibleCount(c => Math.min(c + PAGE_SIZE, books?.length || 0)) },
      { threshold: 0.1 }
    )
    obs.observe(loaderRef.current)
    return () => obs.disconnect()
  }, [books?.length])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '80px 0', gap: 14 }}>
      <div style={{ width: 36, height: 36, border: '2.5px solid rgba(201,168,76,0.12)', borderTop: '2.5px solid var(--gold)', borderRadius: '50%', animation: 'gp-spin 0.75s linear infinite' }}/>
      <style>{`@keyframes gp-spin{to{transform:rotate(360deg)}}`}</style>
      <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 11, color: '#fff', letterSpacing: '.12em' }}>Loading books…</span>
    </div>
  )
  if (!books?.length) return (
    <div style={{ textAlign: 'center', padding: '80px 0' }}>
      <div style={{ marginBottom: 16, opacity: 0.4, display: 'flex', justifyContent: 'center' }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="56" height="56" style={{ color: 'var(--gold)' }}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      </div>
      <p style={{ fontFamily: 'Montaga,serif', color: '#fff', fontSize: 14, margin: '0 0 6px' }}>No books found for this genre.</p>
      <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '.06em', margin: 0 }}>Try a different genre or check your backend connection.</p>
    </div>
  )
  const visible = books.slice(0, visibleCount)
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 20 }}>
        {visible.map((b, i) => (
          <div
            key={(b.title || '') + i}
            onClick={() => onOpen && onOpen(b)}
            style={{ cursor: 'pointer' }}
            onMouseEnter={e => { const c = e.currentTarget.querySelector('.gc-cover'); if (c) c.style.transform = 'scale(1.04)' }}
            onMouseLeave={e => { const c = e.currentTarget.querySelector('.gc-cover'); if (c) c.style.transform = 'scale(1)' }}
          >
            <div className="gc-cover" style={{ borderRadius: 10, overflow: 'hidden', aspectRatio: '2/3', background: 'rgba(114,57,63,0.2)', transition: 'transform 0.22s cubic-bezier(0.22,1,0.36,1)' }}>
              <BookCover book={b} />
            </div>
            <div style={{ padding: '7px 2px 0' }}>
              <div style={{ fontFamily: 'Montaga,serif', fontSize: 12, fontWeight: 600, color: '#fff', lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{b.title}</div>
              <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 400, color: 'rgba(255,255,255,0.65)', marginTop: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{b.authors}</div>
              {Number(b.average_rating) > 0 && (
                <div style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: 'var(--gold)', marginTop: 3, fontWeight: 600 }}>★ {Number(b.average_rating).toFixed(1)}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {visibleCount < books.length && (
        <div ref={loaderRef} style={{ padding: '32px 0', textAlign: 'center' }}>
          <span style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: '.1em' }}>Showing {visibleCount} of {books.length} books</span>
        </div>
      )}
    </>
  )
}

// GENRE SEARCH BAR
function GenreSearch({ value, onChange }) {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search genres…"
        style={{ width: '100%', padding: '8px 34px 8px 13px', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 30, color: '#fff', fontFamily: 'Montaga,serif', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = 'rgba(201,168,76,0.7)'}
        onBlur={e => e.target.style.borderColor = 'rgba(201,168,76,0.3)'}
      />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.5)', pointerEvents: 'none' }}>
        <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
      </svg>
    </div>
  )
}

// CORE FETCH HELPER
async function tryFetch(url, signal) {
  try {
    const r = await fetch(url, { signal })
    if (!r.ok) return null
    return await r.json()
  } catch (e) {
    if (e.name === 'AbortError') throw e
    return null
  }
}

const AUTHORS_BY_GENRE = {
  'fiction': ['Patterson', 'Atwood', 'Grisham', 'Picoult', 'King', 'Rooney', 'Moyes', 'Murakami'],
  'fantasy': ['Tolkien', 'Sanderson', 'Jordan', 'Riordan', 'Maas', 'Gaiman', 'Rothfuss', 'Martin'],
  'mystery': ['Christie', 'Penny', 'Connelly', 'Osman', 'Doyle', 'Child', 'Moriarty', 'Hawkins'],
  'romance': ['Sparks', 'Moyes', 'Hoover', 'Austen', 'Quinn', 'Roberts', 'Henry', 'Kleypas'],
  'thriller': ['Patterson', 'Child', 'Flynn', 'Hawkins', 'Turow', 'Baldacci', 'King', 'Silva'],
  'science fiction': ['Herbert', 'Asimov', 'Weir', 'Crouch', 'Corey', 'Wells', 'Stephenson'],
  'horror': ['King', 'Koontz', 'Rice', 'Jackson', 'Stoker', 'Barker', 'Straub'],
  'biography': ['Isaacson', 'Chernow', 'McCullough', 'Caro', 'Obama', 'Trevor Noah'],
  'history': ['Larson', 'Grann', 'Macintyre', 'Tuchman', 'Ambrose', 'Frankopan'],
  'self-help': ['Clear', 'Manson', 'Goggins', 'Covey', 'Brown', 'Holiday', 'Tolle'],
  'comedy': ['Sedaris', 'Poehler', 'Fey', 'Noah', 'Bryson', 'Adams', 'Pratchett'],
  'young-adult': ['Rowling', 'Collins', 'Green', 'Meyer', 'Schwab', 'Black', 'Riordan'],
  'classics': ['Austen', 'Dickens', 'Tolkien', 'Orwell', 'Fitzgerald', 'Hemingway', 'Bronte'],
  'crime': ['Chandler', 'Connelly', 'French', 'Patterson', 'Ellroy', 'Grisham', 'Child'],
  'paranormal': ['Meyer', 'Ward', 'Harris', 'Briggs', 'Singh', 'Maas', 'Clare'],
  'adventure': ['Cussler', 'Rollins', 'Riordan', 'Tolkien', 'Rowling', 'Defoe'],
  'non-fiction': ['Gladwell', 'Harari', 'Bryson', 'Krakauer', 'Lewis', 'Kahneman'],
  'psychology': ['Kahneman', 'Sapolsky', 'Pink', 'Goleman', 'Ariely', 'Duhigg'],
  'philosophy': ['Aurelius', 'Seneca', 'Plato', 'Sartre', 'Nietzsche', 'Camus'],
  'poetry': ['Kaur', 'Oliver', 'Angelou', 'Whitman', 'Plath', 'Dickinson'],
  'graphic novel': ['Vaughan', 'Moore', 'Spiegelman', 'Kirkman', 'Tamaki', 'Gaiman'],
  'children': ['Dahl', 'Rowling', 'Riordan', 'Kinney', 'Pilkey', 'Seuss', 'White'],
  'rom-com': ['Kinsella', 'Henry', 'Fielding', 'Simsion', 'Sparks', 'Thorne', 'McQuiston'],
  'action-thriller': ['Child', 'Ludlum', 'Fleming', 'Flynn', 'Thor', 'Clancy'],
  'horror-thriller': ['King', 'Harris', 'Flynn', 'Koontz', 'McFadden', 'Hill'],
  'romantic-suspense': ['Roberts', 'Brown', 'Coben', 'Howard', 'Garwood', 'Ward'],
  'dark-fantasy': ['Abercrombie', 'Kuang', 'Gaiman', 'Lawrence', 'Erikson', 'Bancroft'],
  'cozy-mystery': ['Christie', 'Osman', 'Beaton', 'Bradley', 'Bowen', 'Childs'],
  'sci-fi-thriller': ['Crouch', 'Weir', 'Crichton', 'Gibson', 'Stephenson', 'Cline'],
  'historical-fiction': ['Quinn', 'Hannah', 'Doerr', 'Follett', 'Mantel', 'Gregory', 'Towles'],
  'paranormal-romance': ['Maas', 'Mead', 'Fitzpatrick', 'Ward', 'Kenyon', 'Showalter'],
  'literary-fiction': ['Yanagihara', 'Roy', 'Tartt', 'Eugenides', 'Franzen', 'Ishiguro'],
  'true-crime': ['Rule', 'Grann', 'Bugliosi', 'McNamara', 'Capote', 'Larson'],
  'spy-thriller': ['Le Carre', 'Fleming', 'Silva', 'Ludlum', 'Child', 'Horowitz']
}

function extractBooks(raw) {
  return Array.isArray(raw) ? raw : (raw?.books || [])
}
async function fetchGenreBooks(genre, signal, topN = 500) {
  const clusters = SEED_CLUSTERS[genre.key] || []
  const blocklist = genre.blocklist || []

  const filter = raw =>
    dedup(extractBooks(raw)).filter(b => isClean(b, blocklist))

  // BYPASS: The backend recommend_by_genre is too slow (>60s). We instead pull books from:
  //   1. /recommend/author for all canonical genre authors (fast, <1s each)
  //   2. /search for top seed titles (fast, <1s each)
  //   3. /trending (filtered client-side to genre)
  // All results are merged, deduped, and returned.

  let finalBooks = []
  const genreApiKey = genre.key
  const authors = (AUTHORS_BY_GENRE[genreApiKey] || []).slice(0, 10) // up to 10 authors

  // Seed titles from clusters (just seeds, no similar — seeds are most distinctive)
  const seedQueries = [...new Set(
    (clusters || []).map(c => c.seed).filter(Boolean)
  )].slice(0, 8)

  console.log(`[GenrePage] Fetching ${authors.length} authors + ${seedQueries.length} seeds + trending for "${genre.label}"`)

  const [trendingResult, ...restResults] = await Promise.allSettled([
    tryFetch(`${API_BASE}/trending?top_n=250`, signal),
    ...authors.map(a => tryFetch(`${API_BASE}/recommend/author?author=${encodeURIComponent(a)}&top_n=100`, signal)),
    ...seedQueries.map(term => tryFetch(`${API_BASE}/search?query=${encodeURIComponent(term)}&limit=20`, signal))
  ])

  const gathered = []

  // 1. Trending — filter client-side by genre label keywords
  if (trendingResult.status === 'fulfilled' && trendingResult.value) {
    const genreWords = genre.label.toLowerCase().split(/\s+/).filter(w => w.length > 3)
    const trendingBooks = extractBooks(trendingResult.value).filter(b => {
      if (!b.genre) return false
      const g = b.genre.toLowerCase()
      return genreWords.some(w => g.includes(w))
    })
    gathered.push(...trendingBooks)
  }

  // 2. Author results + seed results — include everything (authors are curated per genre)
  for (const r of restResults) {
    if (r.status === 'fulfilled' && r.value) {
      gathered.push(...extractBooks(r.value))
    }
  }

  // Deduplicate and clean
  finalBooks = dedup(gathered).filter(b => isClean(b, genre.blocklist || []))

  // Sort by rating as a quality signal (descending)
  finalBooks.sort((a, b) => (b.average_rating || 0) - (a.average_rating || 0))

  console.log(`[GenrePage] ${finalBooks.length} books ready for "${genre.label}"`)

  return { books: finalBooks.slice(0, topN), source: 'ranked' }
}

// SIDEBAR GROUPS
const GENRE_GROUPS = [
  {
    label: 'Core Genres',
    keys: ['fiction','fantasy','mystery','romance','thriller','science fiction','horror',
           'biography','history','self-help','comedy','young-adult','classics','crime',
           'paranormal','adventure','non-fiction','psychology','philosophy','poetry',
           'graphic novel','children']
  },
  {
    label: 'Hybrid Genres',
    keys: ['rom-com','chick-lit','action-thriller','horror-thriller','romantic-suspense',
           'dark-fantasy','cozy-mystery','sci-fi-thriller','historical-fiction',
           'paranormal-romance','literary-fiction','urban-fantasy','dystopian',
           'true-crime','spy-thriller']
  },
]

// MAIN PAGE
export function GenrePage({ onOpen, initialGenre }) {
  const resolveInitial = useCallback(() => {
    if (!initialGenre) return ALL_GENRES[0]
    const norm = (initialGenre || '').toLowerCase().trim()
    return (
      ALL_GENRES.find(g => g.key === norm) ||
      ALL_GENRES.find(g => g.label.toLowerCase() === norm) ||
      ALL_GENRES.find(g => norm.includes(g.key) || g.key.includes(norm)) ||
      ALL_GENRES[0]
    )
  }, [initialGenre])

  const [activeGenre, setActiveGenre] = useState(resolveInitial)
  const [books, setBooks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [genreSearch, setGenreSearch] = useState('')

  useEffect(() => {
    if (initialGenre) setActiveGenre(resolveInitial())
  }, [initialGenre])

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    let cancelled = false
    const timeoutId = setTimeout(() => { if (!cancelled) controller.abort() }, 30000)

    setLoading(true)
    setBooks([])
    setError('')

    async function load() {
      try {
        const result = await fetchGenreBooks(activeGenre, signal, 500)
        if (cancelled) return
        if (result.books.length) {
          setBooks(result.books)
          setLoading(false)
        } else {
          if (!cancelled) {
            setError(`No books found for "${activeGenre.label}".`)
            setLoading(false)
          }
        }
      } catch (e) {
        if (cancelled) return
        setError(e.name === 'AbortError'
          ? `Request timed out. Is your backend running at ${API_BASE}?`
          : `Could not reach backend at ${API_BASE}.`)
        setLoading(false)
      }
    }
    load()

    return () => { cancelled = true; clearTimeout(timeoutId); controller.abort() }
  }, [activeGenre.key])

  const filteredGenres = genreSearch.trim()
    ? ALL_GENRES.filter(g =>
        g.label.toLowerCase().includes(genreSearch.toLowerCase()) ||
        g.key.toLowerCase().includes(genreSearch.toLowerCase())
      )
    : ALL_GENRES

  const groupedFiltered = GENRE_GROUPS.map(grp => ({
    ...grp,
    genres: filteredGenres.filter(g => grp.keys.includes(g.key))
  })).filter(grp => grp.genres.length > 0)

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* Sidebar */}
      <div style={{
        width: 210, flexShrink: 0, overflowY: 'auto',
        borderRight: '1px solid rgb(143,108,10)',
        background: 'rgba(160,123,42,0.53)',
        paddingTop: 12,
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(114,57,63,0.4) transparent',
        display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ padding: '4px 12px 10px' }}>
          <GenreSearch value={genreSearch} onChange={setGenreSearch} />
        </div>
        {groupedFiltered.map(grp => (
          <div key={grp.label}>
            <div style={{
              fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 8.5,
              fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: '.2em',
              textTransform: 'uppercase', padding: '10px 18px 6px',
              borderTop: '1px solid rgba(201,168,76,0.12)'
            }}>
              {grp.label}
            </div>
            {grp.genres.map(g => (
              <div
                key={g.key}
                onClick={() => { setActiveGenre(g); setGenreSearch('') }}
                style={{
                  padding: '9px 18px', cursor: 'pointer',
                  fontFamily: 'Montaga,serif', fontSize: 13,
                  color: activeGenre.key === g.key ? 'var(--gold)' : 'rgba(255,255,255,0.85)',
                  background: activeGenre.key === g.key ? 'rgba(201,168,76,0.12)' : 'transparent',
                  borderLeft: activeGenre.key === g.key ? '2px solid var(--gold)' : '2px solid transparent',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => { if (activeGenre.key !== g.key) e.currentTarget.style.color = '#fff' }}
                onMouseLeave={e => { if (activeGenre.key !== g.key) e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}
              >
                {g.label}
              </div>
            ))}
          </div>
        ))}
        {filteredGenres.length === 0 && (
          <div style={{ padding: '20px 18px', fontFamily: 'Montaga,serif', fontSize: 12, color: 'rgba(255,255,255,0.6)', textAlign: 'center' }}>
            No genres match
          </div>
        )}
      </div>

      {/* Main content */}
      <div style={{
        flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column',
        scrollbarWidth: 'thin', scrollbarColor: 'rgba(114,57,63,0.4) transparent'
      }}>
        <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid rgba(201,168,76,0.08)', background: 'linear-gradient(135deg,#617891 0%,#25344f 50%,#25344f 100%)' }}>
          <p style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 10, fontWeight: 700, color: 'rgba(201,168,76,0.9)', letterSpacing: '.22em', textTransform: 'uppercase', margin: '0 0 5px' }}>
            Browse by Genre
          </p>
          <h2 style={{ fontFamily: 'Montserrat Alternates,sans-serif', fontSize: 28, fontWeight: 800, color: '#fff', margin: '0 0 10px', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>
            {activeGenre.label}
          </h2>
          <p style={{ fontFamily: 'Montaga,serif', fontSize: 13, color: 'rgba(255,255,255,0.75)', margin: 0 }}>
            {loading
              ? 'Loading…'
              : error ? <span style={{ color: '#f09aaa' }}>{error}</span>
              : `${books.length} book${books.length !== 1 ? 's' : ''} found`}
          </p>
        </div>
        <div style={{ padding: '16px 28px 48px' }}>
          <BookGrid books={books} loading={loading} onOpen={onOpen} />
        </div>
      </div>
    </div>
  )
}